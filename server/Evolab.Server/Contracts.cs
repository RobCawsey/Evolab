using Evolab.Server.Data;

namespace Evolab.Server;

/// <summary>
/// What crosses the wire. Records rather than the entities, so a storage change is not
/// automatically a breaking API change — and so a run cannot arrive carrying an Id or a
/// ShareToken it has no business setting.
/// </summary>
public sealed record RunSummaryDto(
    Guid Id, DateTimeOffset CreatedAt, string Title,
    double ChampionFitness, double ChampionDistance, int Generations, string? ShareToken)
{
    public static RunSummaryDto From(Run r) => new(
        r.Id, r.CreatedAt, r.Title, r.ChampionFitness, r.ChampionDistance, r.Generations, r.ShareToken);
}

public sealed record ArchiveCellDto(int Index, double Fitness, double Stride, double Duty, string Genes);
public sealed record HistoryPointDto(int Generation, double Best, double Mean, double Diversity);

public sealed record RunDto(
    Guid Id, DateTimeOffset CreatedAt, string Title,
    int Seed, int Generations, int Population, double TrialSeconds, int Workers,
    string GoalKey, double GoalDistance, double GoalUpright, double GoalEffort, double GoalEffortBudget,
    string BodySpec,
    string ChampionGenome, double ChampionFitness, double ChampionDistance, double ChampionUpright,
    double ChampionEffort, bool ChampionFell, double ChampionStride, double ChampionDuty,
    string? TrajectoryHash, string? ShareToken,
    IReadOnlyList<ArchiveCellDto> Archive, IReadOnlyList<HistoryPointDto> History)
{
    public static RunDto From(Run r) => new(
        r.Id, r.CreatedAt, r.Title, r.Seed, r.Generations, r.Population, r.TrialSeconds, r.Workers,
        r.GoalKey, r.GoalDistance, r.GoalUpright, r.GoalEffort, r.GoalEffortBudget, r.BodySpec,
        r.ChampionGenome, r.ChampionFitness, r.ChampionDistance, r.ChampionUpright, r.ChampionEffort,
        r.ChampionFell, r.ChampionStride, r.ChampionDuty, r.TrajectoryHash, r.ShareToken,
        r.Archive.Select(c => new ArchiveCellDto(c.Index, c.Fitness, c.Stride, c.Duty, c.Genes)).ToList(),
        r.History.OrderBy(h => h.Generation)
            .Select(h => new HistoryPointDto(h.Generation, h.Best, h.Mean, h.Diversity)).ToList());
}

/// <summary>
/// What the browser may send. Deliberately narrower than <see cref="RunDto"/>: no Id, no
/// CreatedAt, no ShareToken. Those are the server's to decide, and accepting them would let a
/// client overwrite somebody else's share link by guessing.
/// </summary>
public sealed record NewRunDto(
    string? Title,
    int Seed, int Generations, int Population, double TrialSeconds, int Workers,
    string GoalKey, double GoalDistance, double GoalUpright, double GoalEffort, double GoalEffortBudget,
    string BodySpec,
    string ChampionGenome, double ChampionFitness, double ChampionDistance, double ChampionUpright,
    double ChampionEffort, bool ChampionFell, double ChampionStride, double ChampionDuty,
    string? TrajectoryHash,
    IReadOnlyList<ArchiveCellDto>? Archive, IReadOnlyList<HistoryPointDto>? History)
{
    public Run ToEntity() => new()
    {
        Title = string.IsNullOrWhiteSpace(Title) ? GoalKey : Title.Trim(),
        Seed = Seed, Generations = Generations, Population = Population,
        TrialSeconds = TrialSeconds, Workers = Workers,
        GoalKey = GoalKey, GoalDistance = GoalDistance, GoalUpright = GoalUpright,
        GoalEffort = GoalEffort, GoalEffortBudget = GoalEffortBudget,
        BodySpec = BodySpec,
        ChampionGenome = ChampionGenome, ChampionFitness = ChampionFitness,
        ChampionDistance = ChampionDistance, ChampionUpright = ChampionUpright,
        ChampionEffort = ChampionEffort, ChampionFell = ChampionFell,
        ChampionStride = ChampionStride, ChampionDuty = ChampionDuty,
        TrajectoryHash = TrajectoryHash,
        Archive = (Archive ?? []).Select(c => new ArchiveCell
        {
            Index = c.Index, Fitness = c.Fitness, Stride = c.Stride, Duty = c.Duty, Genes = c.Genes,
        }).ToList(),
        History = (History ?? []).Select(h => new HistoryPoint
        {
            Generation = h.Generation, Best = h.Best, Mean = h.Mean, Diversity = h.Diversity,
        }).ToList(),
    };

    /// <summary>
    /// Cheap sanity, not a validation framework. The genome is eleven numbers and the archive
    /// cannot exceed the grid; anything wilder is a bug or an attempt, and either way a 400
    /// with a stable code is the honest answer.
    /// </summary>
    public string? Validate()
    {
        if (string.IsNullOrWhiteSpace(ChampionGenome)) return "A run needs a champion.";
        if (Generations is < 0 or > 100_000) return "That generation count is not plausible.";
        if ((Archive?.Count ?? 0) > 576) return "That archive is larger than the grid.";
        if ((History?.Count ?? 0) > 100_000) return "That history is too long.";
        return null;
    }
}
