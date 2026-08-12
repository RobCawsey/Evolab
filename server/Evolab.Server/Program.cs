using Evolab.Server;
using Evolab.Server.Data;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

// Runtime state lives *beside* the project, never inside it.
//
// The first version defaulted to `ContentRootPath/data`, which on a case-insensitive
// filesystem is the same directory as the source folder `Data/` — the SQLite file landed
// among the entity classes, and a stray `rm -rf data` then took the source with it. A
// dot-prefixed sibling cannot collide with a C# folder and is obviously not source.
var dataDir = builder.Configuration["Evolab:DataDirectory"]
    ?? Path.Combine(builder.Environment.ContentRootPath, "..", ".data");
Directory.CreateDirectory(dataDir);

// The endpoints depend on IRunRepository and ITrajectoryStore, not on EF Core — so a host
// that supplies its own (the tests) can skip the database entirely rather than registering a
// second provider and colliding with this one. That the switch is possible at all is the
// claim the two interfaces make, stated in configuration.
if (builder.Configuration.GetValue("Evolab:UseDatabase", true))
{
    builder.Services.AddDbContext<EvolabContext>(options =>
        options.UseSqlite($"Data Source={Path.Combine(dataDir, "evolab.db")}"));
    builder.Services.AddScoped<IRunRepository, RunRepository>();
    builder.Services.AddScoped<ICommunityArchive, CommunityArchive>();
    builder.Services.AddSingleton<ITrajectoryStore>(
        _ => new FileTrajectoryStore(Path.Combine(dataDir, "trajectories")));
}

// Turns unhandled exceptions and bare status codes into RFC 9457 ProblemDetails. In
// production it carries title, status and traceId and nothing else — the detail stays in the
// log, where traceId finds it.
builder.Services.AddProblemDetails();

var app = builder.Build();

app.UseExceptionHandler();
app.UseStatusCodePages();

using (var scope = app.Services.CreateScope())
{
    // EnsureCreated, not migrations. One SQLite file on one machine; when there are two of
    // anything, revisit (§5).
    var db = scope.ServiceProvider.GetService<EvolabContext>();
    db?.Database.EnsureCreated();
    if (db is not null) Schema.AddMissingTables(db);
}

app.MapApi();

// One origin, so no CORS and one deploy. `npm run build` writes into wwwroot; in development
// Vite serves the app on 5173 and proxies /api here, so the browser keeps hot reload.
app.UseDefaultFiles();
app.UseStaticFiles();
app.MapFallbackToFile("index.html");

app.Run();

/// <summary>Exposed so the test project can spin the app up in memory.</summary>
public partial class Program;
