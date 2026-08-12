using Evolab.Server.Data;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace Evolab.Server.Tests;

/// <summary>
/// The repository against <b>real SQLite</b>, in memory.
///
/// This file exists because of a bug the endpoint tests could not have caught. Listing orders
/// by <c>CreatedAt</c>, the fake orders in LINQ-to-Objects — which sorts a
/// <c>DateTimeOffset</c> happily — and every endpoint test passed against a query the real
/// provider refuses to translate at all. The server 500'd the first time it was run by hand.
///
/// So: fakes prove endpoint behaviour, and only the real provider proves persistence
/// behaviour. Both are needed and neither substitutes for the other. In-memory SQLite is real
/// SQLite with a real query pipeline, so it costs a connection rather than a file.
/// </summary>
public sealed class RepositoryTests : IDisposable
{
    private readonly SqliteConnection _connection;
    private readonly EvolabContext _db;
    private readonly RunRepository _runs;

    public RepositoryTests()
    {
        // Kept open: an in-memory SQLite database exists only as long as its connection does.
        _connection = new SqliteConnection("Data Source=:memory:");
        _connection.Open();
        _db = new EvolabContext(new DbContextOptionsBuilder<EvolabContext>()
            .UseSqlite(_connection).Options);
        _db.Database.EnsureCreated();
        _runs = new RunRepository(_db);
    }

    public void Dispose()
    {
        _db.Dispose();
        _connection.Dispose();
    }

    private static Run Sample(string title) => new()
    {
        Title = title,
        GoalKey = "far", GoalDistance = 1, GoalUpright = 0.5, GoalEffort = 0.3, GoalEffortBudget = 140,
        BodySpec = "0.36,0.18", ChampionGenome = "0.469,0.639", ChampionFitness = 6.4598,
        Archive = [new ArchiveCell { Index = 343, Fitness = 6.4598, Stride = 0.923, Duty = 0.8, Genes = "0.469" }],
        History = [new HistoryPoint { Generation = 0, Best = 1.2, Mean = 0.4, Diversity = 0.31 }],
    };

    [Fact]
    public async Task Listing_orders_newest_first_in_actual_SQL()
    {
        // The regression guard. Before the UtcTicks conversion this threw
        // NotSupportedException: "SQLite does not support expressions of type 'DateTimeOffset'
        // in ORDER BY clauses" — and no fake could ever have said so.
        await _runs.AddAsync(Sample("older"), default);
        await Task.Delay(5);
        await _runs.AddAsync(Sample("newer"), default);

        var list = await _runs.ListAsync(50, default);

        Assert.Equal(2, list.Count);
        Assert.Equal("newer", list[0].Title);
        Assert.Equal("older", list[1].Title);
    }

    [Fact]
    public async Task CreatedAt_survives_the_round_trip_through_ticks()
    {
        var id = await _runs.AddAsync(Sample("run"), default);
        var stored = await _runs.GetAsync(id, default);

        Assert.NotNull(stored);
        Assert.Equal(TimeSpan.Zero, stored!.CreatedAt.Offset);
        Assert.True((DateTimeOffset.UtcNow - stored.CreatedAt).Duration() < TimeSpan.FromMinutes(1));
    }

    [Fact]
    public async Task The_owned_collections_are_saved_and_loaded_with_the_run()
    {
        var id = await _runs.AddAsync(Sample("run"), default);
        var stored = await _runs.GetAsync(id, default);

        // Owned collections load without an explicit Include — if that ever changes, a
        // stored run silently comes back with an empty behaviour map.
        Assert.Single(stored!.Archive);
        Assert.Equal(343, stored.Archive[0].Index);
        Assert.Single(stored.History);
    }

    [Fact]
    public async Task Publishing_is_idempotent_and_the_token_is_unique()
    {
        var first = await _runs.AddAsync(Sample("a"), default);
        var second = await _runs.AddAsync(Sample("b"), default);

        var tokenA = await _runs.PublishAsync(first, default);
        var again = await _runs.PublishAsync(first, default);
        var tokenB = await _runs.PublishAsync(second, default);

        Assert.Equal(tokenA, again);
        Assert.NotEqual(tokenA, tokenB);

        // The unique index on ShareToken has to survive two runs being published.
        var found = await _runs.GetByTokenAsync(tokenB!, default);
        Assert.Equal(second, found!.Id);
    }

    [Fact]
    public async Task Publishing_an_unknown_run_returns_null_rather_than_throwing()
    {
        Assert.Null(await _runs.PublishAsync(Guid.NewGuid(), default));
    }

    [Fact]
    public async Task Take_actually_limits_the_query()
    {
        for (var i = 0; i < 5; i++) await _runs.AddAsync(Sample($"run {i}"), default);
        Assert.Equal(3, (await _runs.ListAsync(3, default)).Count);
    }
}
