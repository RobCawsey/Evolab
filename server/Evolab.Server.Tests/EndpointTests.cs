using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Evolab.Server.Data;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;

namespace Evolab.Server.Tests;

/// <summary>
/// Every endpoint, against fakes: no SQLite file, no disk, no fixture teardown. That is what
/// the two repository interfaces are for, and it is a better argument than swappability.
/// </summary>
public sealed class EndpointTests : IClassFixture<EndpointTests.Host>
{
    public sealed class Host : WebApplicationFactory<Program>
    {
        public FakeRunRepository Runs { get; } = new();
        public FakeTrajectoryStore Trajectories { get; } = new();

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            // No database at all. The endpoints depend on the two interfaces, so a host that
            // supplies fakes needs neither EF Core nor a file — which is the whole reason
            // those interfaces exist, demonstrated rather than asserted.
            builder.UseSetting("Evolab:UseDatabase", "false");
            builder.ConfigureServices(services =>
            {
                services.AddSingleton<IRunRepository>(Runs);
                services.AddSingleton<ITrajectoryStore>(Trajectories);
            });
        }
    }

    private readonly Host _host;
    private readonly HttpClient _client;

    public EndpointTests(Host host)
    {
        _host = host;
        _client = host.CreateClient();
    }

    private static NewRunDto SampleRun(string title = "reference champion") => new(
        Title: title,
        Seed: 4417, Generations: 30, Population: 24, TrialSeconds: 4, Workers: 4,
        GoalKey: "far", GoalDistance: 1.0, GoalUpright: 0.5, GoalEffort: 0.3, GoalEffortBudget: 140,
        BodySpec: "0.3600,0.1800,0.2600,0.0900,0.2500,0.0700,0.1600,0.0500,0.0300,130.0000",
        ChampionGenome: "0.469,0.639,0.861,0.340,0.937,0.079,0.726,0.780,0.626,0.682,0.478",
        ChampionFitness: 6.4598, ChampionDistance: 5.96, ChampionUpright: 4,
        ChampionEffort: 47, ChampionFell: false, ChampionStride: 0.923, ChampionDuty: 0.80,
        TrajectoryHash: null,
        Archive: [new ArchiveCellDto(343, 6.4598, 0.923, 0.80, "0.469,0.639")],
        History: [new HistoryPointDto(0, 1.2, 0.4, 0.31), new HistoryPointDto(1, 2.0, 0.9, 0.29)]);

    [Fact]
    public async Task A_run_round_trips()
    {
        var posted = await _client.PostAsJsonAsync("/api/runs", SampleRun());
        Assert.Equal(HttpStatusCode.Created, posted.StatusCode);
        var summary = await posted.Content.ReadFromJsonAsync<RunSummaryDto>();
        Assert.NotNull(summary);
        Assert.Equal(6.4598, summary!.ChampionFitness, 4);

        var fetched = await _client.GetFromJsonAsync<RunDto>($"/api/runs/{summary.Id}");
        Assert.NotNull(fetched);
        // The whole point of storing it: the archive and the chart come back intact.
        Assert.Single(fetched!.Archive);
        Assert.Equal(2, fetched.History.Count);
        Assert.Equal("far", fetched.GoalKey);
        // Denormalised weights survive, so the run can still say what it was scored on.
        Assert.Equal(0.5, fetched.GoalUpright, 4);
    }

    [Fact]
    public async Task Listing_is_newest_first()
    {
        await _client.PostAsJsonAsync("/api/runs", SampleRun("older"));
        await _client.PostAsJsonAsync("/api/runs", SampleRun("newer"));
        var list = await _client.GetFromJsonAsync<List<RunSummaryDto>>("/api/runs");
        Assert.NotNull(list);
        Assert.Equal("newer", list![0].Title);
    }

    [Fact]
    public async Task A_missing_run_is_a_404_with_a_stable_code()
    {
        var response = await _client.GetAsync($"/api/runs/{Guid.NewGuid()}");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);

        using var problem = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        // `code` is what the client branches on; `title` is copy and may be reworded.
        Assert.Equal("run_not_found", problem.RootElement.GetProperty("code").GetString());
        Assert.False(string.IsNullOrWhiteSpace(problem.RootElement.GetProperty("title").GetString()));
    }

    [Fact]
    public async Task A_run_with_no_champion_is_refused()
    {
        var response = await _client.PostAsJsonAsync("/api/runs", SampleRun() with { ChampionGenome = "" });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        using var problem = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("invalid_run", problem.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task An_archive_larger_than_the_grid_is_refused()
    {
        var tooMany = Enumerable.Range(0, 600)
            .Select(i => new ArchiveCellDto(i, 1, 0.5, 0.8, "0")).ToList();
        var response = await _client.PostAsJsonAsync("/api/runs", SampleRun() with { Archive = tooMany });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Publishing_twice_returns_the_same_token()
    {
        var posted = await _client.PostAsJsonAsync("/api/runs", SampleRun());
        var summary = await posted.Content.ReadFromJsonAsync<RunSummaryDto>();

        var first = await _client.PostAsync($"/api/runs/{summary!.Id}/publish", null);
        var second = await _client.PostAsync($"/api/runs/{summary.Id}/publish", null);

        var a = (await first.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString();
        var b = (await second.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString();

        // Idempotent, because the first link may already be pasted somewhere.
        Assert.False(string.IsNullOrWhiteSpace(a));
        Assert.Equal(a, b);

        var shared = await _client.GetFromJsonAsync<RunDto>($"/api/shared/{a}");
        Assert.Equal(summary.Id, shared!.Id);
    }

    [Fact]
    public async Task An_unknown_share_token_is_a_404()
    {
        var response = await _client.GetAsync("/api/shared/not-a-real-token");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        using var problem = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("share_not_found", problem.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task A_trajectory_stores_once_and_serves_by_hash()
    {
        var bytes = new byte[] { 1, 2, 3, 4, 5 };
        var first = await _client.PostAsync("/api/trajectories", new ByteArrayContent(bytes));
        var hash = (await first.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("hash").GetString();
        Assert.False(string.IsNullOrWhiteSpace(hash));

        // The name is the content, so the same bytes must not create a second file.
        var again = await _client.PostAsync("/api/trajectories", new ByteArrayContent(bytes));
        var sameHash = (await again.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("hash").GetString();
        Assert.Equal(hash, sameHash);
        Assert.Single(_host.Trajectories.Files);

        var served = await _client.GetByteArrayAsync($"/api/trajectories/{hash}");
        Assert.Equal(bytes, served);
    }

    [Fact]
    public async Task An_empty_trajectory_is_refused()
    {
        var response = await _client.PostAsync("/api/trajectories", new ByteArrayContent([]));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task An_unexpected_failure_is_a_ProblemDetails_and_leaks_nothing()
    {
        // The rule that matters for a public endpoint: no exception message, no stack, no
        // file path. The detail belongs in the log, where traceId finds it.
        _host.Runs.NextFailure = new InvalidOperationException("secret internal detail at C:\\evolab");
        var response = await _client.GetAsync("/api/runs");

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("secret internal detail", body);
        Assert.DoesNotContain("C:\\", body);
        Assert.DoesNotContain("InvalidOperationException", body);
    }
}
