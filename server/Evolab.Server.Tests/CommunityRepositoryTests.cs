using Evolab.Server.Data;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace Evolab.Server.Tests;

/// <summary>
/// The community archive against <b>real SQLite</b> — slice 12's lesson applied before it can
/// bite twice. A dictionary-backed fake will agree with anything; only the real provider can
/// say whether a non-generated integer key, an upsert and a distinct count survive contact with
/// a database.
///
/// The tie test is the important one. <c>archiveInsert</c> in
/// <c>packages/evolution/src/archive.ts</c> says <em>higher fitness wins, ties keep the
/// incumbent</em>, and this class is the only thing standing between that sentence and a C#
/// method that quietly disagrees with it.
/// </summary>
public sealed class CommunityRepositoryTests : IDisposable
{
    private readonly SqliteConnection _connection;
    private readonly EvolabContext _db;
    private readonly CommunityArchive _community;
    private readonly RunRepository _runs;

    public CommunityRepositoryTests()
    {
        _connection = new SqliteConnection("Data Source=:memory:");
        _connection.Open();
        _db = new EvolabContext(new DbContextOptionsBuilder<EvolabContext>()
            .UseSqlite(_connection).Options);
        _db.Database.EnsureCreated();
        _community = new CommunityArchive(_db);
        _runs = new RunRepository(_db);
    }

    public void Dispose()
    {
        _db.Dispose();
        _connection.Dispose();
    }

    private async Task<Run> Stored(string title, string body, params (int Index, double Fitness)[] cells)
    {
        var run = new Run
        {
            Title = title,
            BodySpec = body,
            GoalKey = "far",
            ChampionGenome = "0.469",
            Archive = cells
                .Select(c => new ArchiveCell
                {
                    Index = c.Index, Fitness = c.Fitness, Stride = 0.9, Duty = 0.8, Genes = "0.469",
                })
                .ToList(),
        };
        await _runs.AddAsync(run, default);
        return run;
    }

    [Fact]
    public async Task A_tie_keeps_the_incumbent()
    {
        // The rule, pinned. Reverse the comparison in ContributeAsync — `>` instead of `>=` —
        // and this is what fails. It is also what makes republishing a no-op, so getting it
        // wrong would churn the shared map every time anybody re-shared a link.
        var incumbent = await Stored("incumbent", "bodyA", (7, 4.0));
        var challenger = await Stored("challenger", "bodyB", (7, 4.0));

        await _community.ContributeAsync(incumbent, default);
        var second = await _community.ContributeAsync(challenger, default);

        Assert.Equal(0, second.Owned);
        var cells = await _community.ListAsync(default);
        Assert.Equal("incumbent", Assert.Single(cells).RunTitle);
    }

    [Fact]
    public async Task A_higher_score_takes_the_cell()
    {
        var weak = await Stored("weak", "bodyA", (7, 4.0));
        var strong = await Stored("strong", "bodyB", (7, 4.001));

        await _community.ContributeAsync(weak, default);
        var second = await _community.ContributeAsync(strong, default);

        Assert.Equal(1, second.Owned);
        var cell = Assert.Single(await _community.ListAsync(default));
        Assert.Equal("strong", cell.RunTitle);
        // The body travels with the cell, or the client cannot warn that the gait was evolved
        // on different legs.
        Assert.Equal("bodyB", cell.BodySpec);
    }

    [Fact]
    public async Task The_index_is_the_key_so_a_cell_is_updated_rather_than_duplicated()
    {
        // This is the bound the whole design rests on: 576 rows for ever, however many runs.
        // If EF ever decides Index is generated, contributions become inserts and the table
        // grows without limit.
        for (var i = 0; i < 6; i++)
        {
            var run = await Stored($"run {i}", "bodyA", (3, i));
            await _community.ContributeAsync(run, default);
        }

        var cells = await _community.ListAsync(default);
        Assert.Single(cells);
        Assert.Equal(5.0, cells[0].Fitness, 4);
        Assert.Equal("run 5", cells[0].RunTitle);
    }

    [Fact]
    public async Task Ownership_is_recomputed_and_falls_when_a_later_run_takes_cells_back()
    {
        var first = await Stored("first", "bodyA", (1, 1.0), (2, 1.0), (3, 1.0));
        var second = await Stored("second", "bodyB", (2, 9.0), (3, 9.0));

        var a = await _community.ContributeAsync(first, default);
        Assert.Equal(3, a.Owned);

        await _community.ContributeAsync(second, default);

        // Republishing the first run now honestly reports one cell, not three.
        var again = await _community.ContributeAsync(first, default);
        Assert.Equal(1, again.Owned);
        Assert.Equal(3, again.Total);
    }

    [Fact]
    public async Task Listing_is_ordered_by_index_and_counts_distinct_runs()
    {
        var a = await Stored("a", "bodyA", (9, 1.0), (2, 1.0));
        var b = await Stored("b", "bodyB", (5, 1.0));
        await _community.ContributeAsync(a, default);
        await _community.ContributeAsync(b, default);

        var cells = await _community.ListAsync(default);
        Assert.Equal([2, 5, 9], cells.Select(c => c.Index));
        Assert.Equal(2, CommunityDto.From(cells).Runs);
    }

    [Fact]
    public async Task A_database_that_predates_the_table_gets_it_on_startup()
    {
        // The bug this exists for: `EnsureCreated` builds the schema only when the file does
        // not exist, so slice 13's table never appeared in a database slice 12 had created.
        // Every test passed — they all build a database from scratch — and the server returned
        // "no such table: CommunityCells" on the first real request.
        //
        // Dropping the table is the cheapest honest way to age a database backwards.
        await _db.Database.ExecuteSqlRawAsync("DROP TABLE CommunityCells");

        var run = await Stored("after the upgrade", "bodyA", (12, 2.0));
        await Assert.ThrowsAsync<Microsoft.Data.Sqlite.SqliteException>(
            () => _community.ContributeAsync(run, default));

        Schema.AddMissingTables(_db);

        // And now it works, without disturbing the runs already stored beside it.
        var contribution = await _community.ContributeAsync(run, default);
        Assert.Equal(1, contribution.Owned);
        Assert.Single(await _runs.ListAsync(50, default));
    }

    [Fact]
    public void Adding_missing_tables_is_a_no_op_on_a_database_that_has_them_all()
    {
        // It runs on every startup, so it has to be idempotent rather than merely harmless
        // once. If a statement stopped being recognised as "already exists", this throws.
        Schema.AddMissingTables(_db);
        Schema.AddMissingTables(_db);
    }

    [Fact]
    public async Task Contributing_a_run_with_no_archive_is_harmless()
    {
        var empty = await Stored("nothing survived", "bodyA");
        var contribution = await _community.ContributeAsync(empty, default);

        Assert.Equal(0, contribution.Owned);
        Assert.Equal(0, contribution.Total);
        Assert.Empty(await _community.ListAsync(default));
    }
}
