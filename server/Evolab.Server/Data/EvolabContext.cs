using Microsoft.EntityFrameworkCore;

namespace Evolab.Server.Data;

public sealed class EvolabContext(DbContextOptions<EvolabContext> options) : DbContext(options)
{
    public DbSet<Run> Runs => Set<Run>();
    public DbSet<CommunityCell> Community => Set<CommunityCell>();

    protected override void OnModelCreating(ModelBuilder model)
    {
        // The grid index is the key, which is what bounds the table at 576 rows for ever. It
        // is not generated: the value means something, and letting EF invent one would allow
        // two rows to claim the same cell.
        var cell = model.Entity<CommunityCell>();
        cell.ToTable("CommunityCells");
        cell.HasKey(c => c.Index);
        cell.Property(c => c.Index).ValueGeneratedNever();
        // "How many runs are in this map" is a distinct count over this column.
        cell.HasIndex(c => c.RunId);

        var run = model.Entity<Run>();
        run.HasKey(r => r.Id);

        // Stored as UTC ticks, because **SQLite cannot ORDER BY a DateTimeOffset** — it has
        // no native type for one and refuses the translation outright. Listing is newest
        // first, so this is load-bearing rather than tidiness.
        //
        // Found by running the server, not by testing it. The fake repository orders in
        // LINQ-to-Objects, which sorts a DateTimeOffset happily, so every endpoint test
        // passed against a query the real provider will not execute. Fakes prove endpoint
        // behaviour and cannot prove persistence behaviour — which is why RepositoryTests
        // runs against real SQLite.
        run.Property(r => r.CreatedAt)
            .HasConversion(v => v.UtcTicks, v => new DateTimeOffset(v, TimeSpan.Zero));

        // Listing is always newest first, and the share lookup is by token.
        run.HasIndex(r => r.CreatedAt);
        run.HasIndex(r => r.ShareToken).IsUnique();

        // Cells and points are parts of the run, not entities in their own right — deleting
        // a run takes them with it and nothing else ever references them.
        run.OwnsMany(r => r.Archive, cell =>
        {
            cell.WithOwner().HasForeignKey(c => c.RunId);
            cell.HasKey(c => c.Id);
            cell.ToTable("ArchiveCells");
        });
        run.OwnsMany(r => r.History, point =>
        {
            point.WithOwner().HasForeignKey(p => p.RunId);
            point.HasKey(p => p.Id);
            point.ToTable("HistoryPoints");
        });
    }
}
