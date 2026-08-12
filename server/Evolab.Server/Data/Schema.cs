using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Storage;

namespace Evolab.Server.Data;

/// <summary>
/// The gap between <c>EnsureCreated</c> and migrations, and the reason it needs closing.
///
/// <b><c>EnsureCreated</c> builds the schema only when the database file does not exist.</b> A
/// table added by a later slice therefore never appears in a file created by an earlier one —
/// slice 13 added <c>CommunityCells</c>, and every <c>GET /api/archive</c> against an existing
/// database returned <c>SQLite Error 1: 'no such table'</c> while all 28 tests passed, because
/// every test builds its database from scratch.
///
/// That is the same shape as slice 12's ordering bug: <b>the tests create the world fresh and
/// reality does not.</b> Fakes could not prove persistence behaviour there; a fresh database
/// cannot prove upgrade behaviour here.
///
/// Full migrations are the real answer and they do not fit yet: an existing database created by
/// <c>EnsureCreated</c> has no <c>__EFMigrationsHistory</c>, so <c>Migrate()</c> would try to
/// create tables that are already there. Baselining that is more machinery than one SQLite file
/// on one machine has earned. <b>The limit of what is below is new tables</b> — it will not add
/// a column, drop one or change a type, and the day one of those is needed is the day §5's
/// "revisit when there are two of anything" has actually arrived.
/// </summary>
public static class Schema
{
    public static void AddMissingTables(EvolabContext db)
    {
        // Generated from the model rather than written by hand, so it cannot drift away from
        // the entity classes — a hand-copied CREATE TABLE that silently lacks a column added
        // later would be wrong only on databases that already exist, which is the nastiest
        // place for it to be wrong.
        var creator = db.GetService<IRelationalDatabaseCreator>() as RelationalDatabaseCreator;
        if (creator is null) return;
        var statements = creator.GenerateCreateScript()
            .Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        foreach (var statement in statements)
        {
            try
            {
                db.Database.ExecuteSqlRaw(statement);
            }
            catch (Microsoft.Data.Sqlite.SqliteException e)
                when (e.Message.Contains("already exists", StringComparison.OrdinalIgnoreCase))
            {
                // Everything the database already has, which on a fresh one is all of it.
            }
        }
    }
}
