using System.Net.Http.Json;
using Evolab.Server.Data;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;

namespace Evolab.Server.Tests;

/// <summary>
/// Slice 13's endpoints, against fakes.
///
/// <b>A fresh host per test, not an <c>IClassFixture</c>.</b> The community archive is shared
/// mutable state by design — that is the entire feature — so a fixture shared across the class
/// makes every total depend on which tests ran first. The first draft of this file did exactly
/// that and two assertions read 7 and 4 where they said 2. Counting cells is most of what these
/// tests do, so the counts have to start from zero.
/// </summary>
public sealed class CommunityTests : IDisposable
{
    public sealed class Host : WebApplicationFactory<Program>
    {
        public FakeRunRepository Runs { get; } = new();
        public FakeCommunityArchive Community { get; } = new();

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseSetting("Evolab:UseDatabase", "false");
            builder.ConfigureServices(services =>
            {
                services.AddSingleton<IRunRepository>(Runs);
                services.AddSingleton<ICommunityArchive>(Community);
                services.AddSingleton<ITrajectoryStore>(new FakeTrajectoryStore());
            });
        }
    }

    private readonly Host _host = new();
    private readonly HttpClient _client;

    public CommunityTests() => _client = _host.CreateClient();

    public void Dispose() => _host.Dispose();

    private static NewRunDto Run(string title, string body, params (int Index, double Fitness)[] cells) => new(
        Title: title,
        Seed: 4417, Generations: 30, Population: 24, TrialSeconds: 4, Workers: 4,
        GoalKey: "far", GoalDistance: 1.0, GoalUpright: 0.5, GoalEffort: 0.3, GoalEffortBudget: 140,
        BodySpec: body,
        ChampionGenome: "0.469,0.639,0.861,0.340,0.937,0.079,0.726,0.780,0.626,0.682,0.478",
        ChampionFitness: 6.4598, ChampionDistance: 5.96, ChampionUpright: 4,
        ChampionEffort: 47, ChampionFell: false, ChampionStride: 0.923, ChampionDuty: 0.80,
        TrajectoryHash: null,
        Archive: cells.Select(c => new ArchiveCellDto(c.Index, c.Fitness, 0.9, 0.8, "0.469")).ToList(),
        History: []);

    private async Task<PublishedDto> Publish(NewRunDto run)
    {
        var posted = await _client.PostAsJsonAsync("/api/runs", run);
        var summary = await posted.Content.ReadFromJsonAsync<RunSummaryDto>();
        var published = await _client.PostAsync($"/api/runs/{summary!.Id}/publish", null);
        return (await published.Content.ReadFromJsonAsync<PublishedDto>())!;
    }

    [Fact]
    public async Task Publishing_contributes_elites_and_reports_what_the_run_owns()
    {
        var first = await Publish(Run("first", "bodyA", (10, 1.0), (11, 2.0)));

        Assert.False(string.IsNullOrWhiteSpace(first.Token));
        Assert.Equal(2, first.Owned);
        Assert.Equal(2, first.Total);

        var map = await _client.GetFromJsonAsync<CommunityDto>("/api/archive");
        Assert.Equal(2, map!.Cells.Count);
        Assert.Equal(1, map.Runs);
        // The body is carried, because a genome only means something against one.
        Assert.Equal("bodyA", map.Cells[0].BodySpec);
        Assert.Equal("first", map.Cells[0].RunTitle);
    }

    [Fact]
    public async Task A_fitter_run_takes_a_cell_and_the_loser_keeps_the_ones_it_still_holds()
    {
        await Publish(Run("weak", "bodyA", (20, 1.0), (21, 1.0)));
        var strong = await Publish(Run("strong", "bodyB", (20, 5.0)));

        // One taken, one left alone.
        Assert.Equal(1, strong.Owned);

        var map = await _client.GetFromJsonAsync<CommunityDto>("/api/archive");
        var taken = map!.Cells.Single(c => c.Index == 20);
        var kept = map.Cells.Single(c => c.Index == 21);
        Assert.Equal("strong", taken.RunTitle);
        Assert.Equal(5.0, taken.Fitness, 4);
        Assert.Equal("weak", kept.RunTitle);
        Assert.Equal(2, map.Runs);
    }

    [Fact]
    public async Task Publishing_the_same_run_twice_changes_nothing_and_says_the_same_thing()
    {
        var run = Run("twice", "bodyA", (30, 3.0), (31, 3.0));
        var posted = await _client.PostAsJsonAsync("/api/runs", run);
        var summary = await posted.Content.ReadFromJsonAsync<RunSummaryDto>();

        var first = await (await _client.PostAsync($"/api/runs/{summary!.Id}/publish", null))
            .Content.ReadFromJsonAsync<PublishedDto>();
        var second = await (await _client.PostAsync($"/api/runs/{summary.Id}/publish", null))
            .Content.ReadFromJsonAsync<PublishedDto>();

        // The reason the number is ownership and not a delta: the second call is a tie against
        // itself, ties lose, nothing changes — and a delta would report zero.
        Assert.Equal(first!.Token, second!.Token);
        Assert.Equal(first.Owned, second.Owned);
        Assert.Equal(2, second.Owned);
        Assert.Equal(first.Total, second.Total);
    }

    [Fact]
    public async Task An_equal_score_does_not_displace_the_incumbent()
    {
        await Publish(Run("incumbent", "bodyA", (40, 4.0)));
        var challenger = await Publish(Run("challenger", "bodyB", (40, 4.0)));

        Assert.Equal(0, challenger.Owned);
        var map = await _client.GetFromJsonAsync<CommunityDto>("/api/archive");
        Assert.Equal("incumbent", map!.Cells.Single(c => c.Index == 40).RunTitle);
    }

    [Fact]
    public async Task An_empty_map_is_an_empty_list_rather_than_a_404()
    {
        // Every other endpoint 404s on a missing thing. This one must not: "nobody has
        // published anything yet" is a state the app has to render, not an error.
        var map = await _client.GetFromJsonAsync<CommunityDto>("/api/archive");
        Assert.Empty(map!.Cells);
        Assert.Equal(0, map.Runs);
    }

    [Fact]
    public async Task Publishing_a_run_that_does_not_exist_is_a_404()
    {
        var response = await _client.PostAsync($"/api/runs/{Guid.NewGuid()}/publish", null);
        Assert.Equal(System.Net.HttpStatusCode.NotFound, response.StatusCode);
    }
}
