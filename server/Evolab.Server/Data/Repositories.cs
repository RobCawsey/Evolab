using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;

namespace Evolab.Server.Data;

/// <summary>
/// The two interfaces exist for one reason: <b>endpoint tests should not need a database or a
/// disk</b>. Swappability was never the argument — EF Core already provides that for the
/// price of a connection string (§5).
///
/// Three rules keep this a seam rather than a second ORM: materialised results and never
/// <c>IQueryable</c>, because a repository that hands back a query has only renamed the
/// database and cannot be faked honestly; one repository per aggregate rather than per table;
/// and no service layer above — the endpoint is the handler.
/// </summary>
public interface IRunRepository
{
    Task<Guid> AddAsync(Run run, CancellationToken ct);
    Task<Run?> GetAsync(Guid id, CancellationToken ct);
    Task<IReadOnlyList<Run>> ListAsync(int take, CancellationToken ct);
    Task<Run?> GetByTokenAsync(string token, CancellationToken ct);
    /// <summary>Mint a share token, or return the existing one. Null when the run is unknown.</summary>
    Task<string?> PublishAsync(Guid id, CancellationToken ct);
}

public interface ITrajectoryStore
{
    /// <summary>Store the buffer and return its content hash. Storing the same bytes twice is a no-op.</summary>
    Task<string> PutAsync(ReadOnlyMemory<byte> buffer, CancellationToken ct);
    Task<Stream?> OpenAsync(string hash, CancellationToken ct);
}

public sealed class RunRepository(EvolabContext db) : IRunRepository
{
    public async Task<Guid> AddAsync(Run run, CancellationToken ct)
    {
        run.Id = run.Id == Guid.Empty ? Guid.NewGuid() : run.Id;
        run.CreatedAt = DateTimeOffset.UtcNow;
        db.Runs.Add(run);
        await db.SaveChangesAsync(ct);
        return run.Id;
    }

    public Task<Run?> GetAsync(Guid id, CancellationToken ct) =>
        db.Runs.AsNoTracking().FirstOrDefaultAsync(r => r.Id == id, ct);

    public async Task<IReadOnlyList<Run>> ListAsync(int take, CancellationToken ct) =>
        // Materialised, not IQueryable. The caller gets a list it cannot accidentally
        // re-query, and the fake can return one honestly.
        await db.Runs.AsNoTracking()
            .OrderByDescending(r => r.CreatedAt)
            .Take(take)
            .ToListAsync(ct);

    public Task<Run?> GetByTokenAsync(string token, CancellationToken ct) =>
        db.Runs.AsNoTracking().FirstOrDefaultAsync(r => r.ShareToken == token, ct);

    public async Task<string?> PublishAsync(Guid id, CancellationToken ct)
    {
        var run = await db.Runs.FirstOrDefaultAsync(r => r.Id == id, ct);
        if (run is null) return null;
        // Idempotent: publishing twice hands back the same link rather than orphaning one
        // that has already been pasted somewhere.
        run.ShareToken ??= Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
        await db.SaveChangesAsync(ct);
        return run.ShareToken;
    }
}

/// <summary>
/// Content-addressed files under a data directory — §5, and the seam it has in mind when it
/// says a blob store abstraction can wait until there is a second machine. When that happens,
/// this is the one class to change.
/// </summary>
public sealed class FileTrajectoryStore(string root) : ITrajectoryStore
{
    public async Task<string> PutAsync(ReadOnlyMemory<byte> buffer, CancellationToken ct)
    {
        var hash = Convert.ToHexString(SHA256.HashData(buffer.Span)).ToLowerInvariant();
        Directory.CreateDirectory(root);
        var path = Path.Combine(root, hash);
        // The name is the content, so an existing file is already correct. Two runs of the
        // same champion share one file for free.
        if (!File.Exists(path)) await File.WriteAllBytesAsync(path, buffer.ToArray(), ct);
        return hash;
    }

    public Task<Stream?> OpenAsync(string hash, CancellationToken ct)
    {
        // The hash arrives from a URL, so it is untrusted input. Anything that is not 64 hex
        // characters is refused before it can become a path.
        if (hash.Length != 64 || !hash.All(Uri.IsHexDigit)) return Task.FromResult<Stream?>(null);
        var path = Path.Combine(root, hash.ToLowerInvariant());
        return Task.FromResult<Stream?>(File.Exists(path) ? File.OpenRead(path) : null);
    }
}
