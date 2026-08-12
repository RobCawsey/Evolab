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

/// <summary>
/// One cell of the shared grid — slice 13. The fittest gait anybody has published that behaves
/// this way.
///
/// <b>Not owned by a run, and everything it needs is copied into it.</b> The community archive
/// is its own aggregate with its own lifetime: a foreign key to <see cref="ArchiveCell"/> would
/// mean that deleting a run — which nothing does today and something might — silently punches
/// holes in a map other people are looking at. The run title and body spec are denormalised for
/// the same reason, and because listing the whole map is then one table scan with no join.
///
/// The grid index is the primary key, so the table physically cannot exceed 576 rows however
/// many runs are published. That bound is the reason this is stored at all rather than merged
/// from every run's cells on read.
/// </summary>
public sealed class CommunityCell
{
    /// <summary>Flat index into the 24 × 24 grid. Primary key: one row per cell, for ever.</summary>
    public int Index { get; set; }

    public Guid RunId { get; set; }
    public string RunTitle { get; set; } = "";

    /// <summary>
    /// The body this gait was evolved on.
    ///
    /// Load-bearing rather than provenance. Slice 7 fixed the topology at six joints so a
    /// genome could be dropped onto different legs; here that happens for real, and eleven
    /// numbers that strode 0.92 m on their robot may be a face-plant on yours. The client
    /// compares this against the body on screen and says which case it is.
    /// </summary>
    public string BodySpec { get; set; } = "";

    public double Fitness { get; set; }
    public double Stride { get; set; }
    public double Duty { get; set; }
    public string Genes { get; set; } = "";
}

/// <summary>
/// What a publish did to the shared map: how many cells this run now owns, out of how many the
/// map holds.
///
/// <b>Ownership, not a delta.</b> Publishing twice returns the same token and must therefore
/// report the same contribution — and a delta cannot, because on the second call a run's own
/// cells tie with themselves and ties lose, so nothing changes and the honest delta is zero.
/// </summary>
public sealed record Contribution(int Owned, int Total);
