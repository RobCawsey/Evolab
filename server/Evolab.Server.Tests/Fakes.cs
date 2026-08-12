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

/// <summary>
/// A dictionary with the same insertion rule. Enough to prove what the *endpoint* does with a
/// contribution — and, as slice 12 recorded, incapable of proving anything about persistence.
/// The rule itself is pinned against real SQLite in <see cref="CommunityRepositoryTests"/>.
/// </summary>
public sealed class FakeCommunityArchive : ICommunityArchive
{
    public Dictionary<int, CommunityCell> Cells { get; } = [];

    public Task<Contribution> ContributeAsync(Run run, CancellationToken ct)
    {
        foreach (var cell in run.Archive)
        {
            if (Cells.TryGetValue(cell.Index, out var held) && held.Fitness >= cell.Fitness) continue;
            Cells[cell.Index] = new CommunityCell
            {
                Index = cell.Index, RunId = run.Id, RunTitle = run.Title, BodySpec = run.BodySpec,
                Fitness = cell.Fitness, Stride = cell.Stride, Duty = cell.Duty, Genes = cell.Genes,
            };
        }
        return Task.FromResult(new Contribution(
            Cells.Values.Count(c => c.RunId == run.Id), Cells.Count));
    }

    public Task<IReadOnlyList<CommunityCell>> ListAsync(CancellationToken ct) =>
        Task.FromResult<IReadOnlyList<CommunityCell>>(
            Cells.Values.OrderBy(c => c.Index).ToList());
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
