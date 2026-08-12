using Evolab.Server.Data;

namespace Evolab.Server.Tests;

/// <summary>
/// The reason the repository interfaces exist. Every endpoint gets tested for what it
/// returns, what it rejects and what it does twice — with no SQLite file, no disk and no
/// fixture teardown.
/// </summary>
public sealed class FakeRunRepository : IRunRepository
{
    private readonly List<Run> _runs = [];

    /// <summary>Set to make the next call fail, so the 500 path can be exercised.</summary>
    public Exception? NextFailure { get; set; }

    private void MaybeThrow()
    {
        var failure = NextFailure;
        if (failure is null) return;
        NextFailure = null;
        throw failure;
    }

    public Task<Guid> AddAsync(Run run, CancellationToken ct)
    {
        MaybeThrow();
        run.Id = run.Id == Guid.Empty ? Guid.NewGuid() : run.Id;
        run.CreatedAt = DateTimeOffset.UtcNow.AddTicks(_runs.Count);
        _runs.Add(run);
        return Task.FromResult(run.Id);
    }

    public Task<Run?> GetAsync(Guid id, CancellationToken ct)
    {
        MaybeThrow();
        return Task.FromResult(_runs.FirstOrDefault(r => r.Id == id));
    }

    public Task<IReadOnlyList<Run>> ListAsync(int take, CancellationToken ct)
    {
        MaybeThrow();
        return Task.FromResult<IReadOnlyList<Run>>(
            _runs.OrderByDescending(r => r.CreatedAt).Take(take).ToList());
    }

    public Task<Run?> GetByTokenAsync(string token, CancellationToken ct)
    {
        MaybeThrow();
        return Task.FromResult(_runs.FirstOrDefault(r => r.ShareToken == token));
    }

    public Task<string?> PublishAsync(Guid id, CancellationToken ct)
    {
        MaybeThrow();
        var run = _runs.FirstOrDefault(r => r.Id == id);
        if (run is null) return Task.FromResult<string?>(null);
        run.ShareToken ??= Guid.NewGuid().ToString("n");
        return Task.FromResult<string?>(run.ShareToken);
    }
}

public sealed class FakeTrajectoryStore : ITrajectoryStore
{
    public Dictionary<string, byte[]> Files { get; } = [];

    public Task<string> PutAsync(ReadOnlyMemory<byte> buffer, CancellationToken ct)
    {
        var hash = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(buffer.Span))
            .ToLowerInvariant();
        Files[hash] = buffer.ToArray();
        return Task.FromResult(hash);
    }

    public Task<Stream?> OpenAsync(string hash, CancellationToken ct) =>
        Task.FromResult<Stream?>(Files.TryGetValue(hash, out var bytes)
            ? new MemoryStream(bytes)
            : null);
}
