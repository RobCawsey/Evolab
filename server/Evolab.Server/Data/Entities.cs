namespace Evolab.Server.Data;

/// <summary>
/// A finished run, as stored. One aggregate: the archive cells and the history belong to it
/// and are never fetched independently, which is why there is one repository and not three.
/// </summary>
public sealed class Run
{
    public Guid Id { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public string Title { get; set; } = "";

    public int Seed { get; set; }
    public int Generations { get; set; }
    public int Population { get; set; }
    public double TrialSeconds { get; set; }
    public int Workers { get; set; }

    /// <summary>
    /// The goal key <em>and</em> the weights it meant at the time.
    ///
    /// Denormalised on purpose. Presets are copy and copy gets reworded; a stored run must
    /// always be able to say what it was actually scored on, not what a preset of that name
    /// means today. Same rule as <c>IslandConfig.trialSeed</c> in slice 2 — if a score
    /// survives, the conditions it was scored under must not change.
    /// </summary>
    public string GoalKey { get; set; } = "";
    public double GoalDistance { get; set; }
    public double GoalUpright { get; set; }
    public double GoalEffort { get; set; }
    public double GoalEffortBudget { get; set; }

    /// <summary>The eleven numbers of <c>encodeSpec</c>, as the URL writes them.</summary>
    public string BodySpec { get; set; } = "";

    public string ChampionGenome { get; set; } = "";
    public double ChampionFitness { get; set; }
    public double ChampionDistance { get; set; }
    public double ChampionUpright { get; set; }
    public double ChampionEffort { get; set; }
    public bool ChampionFell { get; set; }
    public double ChampionStride { get; set; }
    public double ChampionDuty { get; set; }

    /// <summary>Content hash of the recorded trajectory, when one was uploaded.</summary>
    public string? TrajectoryHash { get; set; }

    /// <summary>
    /// Unguessable, and the whole security model until accounts exist (§5: "auth last, and
    /// minimal"). Anything reachable by token is public — nothing goes in a run record that
    /// would embarrass somebody if scraped.
    /// </summary>
    public string? ShareToken { get; set; }

    public List<ArchiveCell> Archive { get; set; } = [];
    public List<HistoryPoint> History { get; set; } = [];
}

/// <summary>One filled cell of the behaviour map. Empty cells are not stored.</summary>
public sealed class ArchiveCell
{
    public long Id { get; set; }
    public Guid RunId { get; set; }
    /// <summary>Flat index into the 24 × 24 grid, row-major with duty as the row.</summary>
    public int Index { get; set; }
    public double Fitness { get; set; }
    public double Stride { get; set; }
    public double Duty { get; set; }
    /// <summary>The eleven genes, comma-separated. Small enough not to earn a table.</summary>
    public string Genes { get; set; } = "";
}

public sealed class HistoryPoint
{
    public long Id { get; set; }
    public Guid RunId { get; set; }
    public int Generation { get; set; }
    public double Best { get; set; }
    public double Mean { get; set; }
    public double Diversity { get; set; }
}
