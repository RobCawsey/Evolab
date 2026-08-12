using Evolab.Server.Data;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;

namespace Evolab.Server;

/// <summary>
/// Nine endpoints and no layer above them. The endpoint <em>is</em> the handler — if a
/// method would only forward to the repository, the endpoint calls the repository.
///
/// Failures are RFC 9457 <c>ProblemDetails</c> with a short stable <c>code</c> extension, and
/// real HTTP status codes. Returning 200 with <c>{ok:false}</c> so the client sees one shape
/// would lie to every cache, proxy and devtools panel in the path; the uniform shape is the
/// client's job, and <c>api.ts</c> does it in one function.
/// </summary>
public static class Endpoints
{
    /// <summary>Nothing internal crosses the wire: no exception text, no stack, no paths.</summary>
    private static IResult Problem(int status, string code, string title) =>
        Results.Problem(
            title: title,
            statusCode: status,
            type: $"https://evolab/errors/{code}",
            extensions: new Dictionary<string, object?> { ["code"] = code });

    public static void MapApi(this WebApplication app)
    {
        var api = app.MapGroup("/api");

        api.MapGet("/runs", async (IRunRepository runs, CancellationToken ct) =>
            Results.Ok((await runs.ListAsync(50, ct)).Select(RunSummaryDto.From)));

        api.MapGet("/runs/{id:guid}", async (Guid id, IRunRepository runs, CancellationToken ct) =>
        {
            var run = await runs.GetAsync(id, ct);
            return run is null
                ? Problem(404, "run_not_found", "That run does not exist.")
                : Results.Ok(RunDto.From(run));
        });

        api.MapPost("/runs", async (NewRunDto dto, IRunRepository runs, CancellationToken ct) =>
        {
            var complaint = dto.Validate();
            if (complaint is not null) return Problem(400, "invalid_run", complaint);
            var id = await runs.AddAsync(dto.ToEntity(), ct);
            var saved = await runs.GetAsync(id, ct);
            return Results.Created($"/api/runs/{id}", RunSummaryDto.From(saved!));
        });

        // One action, two effects — §5's endpoint table says so: mint a share token *and*
        // contribute this run's elites to the community archive. Publishing is the only
        // explicit "make this public" gesture in the app, so it is the only honest place to
        // hang contribution off; a separate button would let one happen without the other and
        // leave nobody able to say which.
        api.MapPost("/runs/{id:guid}/publish", async (
            Guid id, IRunRepository runs, ICommunityArchive community, CancellationToken ct) =>
        {
            var token = await runs.PublishAsync(id, ct);
            if (token is null) return Problem(404, "run_not_found", "That run does not exist.");
            var run = await runs.GetAsync(id, ct);
            var contribution = await community.ContributeAsync(run!, ct);
            return Results.Ok(new PublishedDto(token, contribution.Owned, contribution.Total));
        });

        // At most 576 cells whatever is behind it, which is the whole reason the merge happens
        // on publish rather than here.
        api.MapGet("/archive", async (ICommunityArchive community, CancellationToken ct) =>
            Results.Ok(CommunityDto.From(await community.ListAsync(ct))));

        // Anonymous and public by design. Anything reachable by token is public, so nothing
        // goes into a run record that would embarrass somebody if scraped.
        api.MapGet("/shared/{token}", async (string token, IRunRepository runs, CancellationToken ct) =>
        {
            var run = await runs.GetByTokenAsync(token, ct);
            return run is null
                ? Problem(404, "share_not_found", "That link is not valid.")
                : Results.Ok(RunDto.From(run));
        });

        api.MapPost("/trajectories", async (HttpRequest request, ITrajectoryStore store, CancellationToken ct) =>
        {
            using var buffer = new MemoryStream();
            await request.Body.CopyToAsync(buffer, ct);
            if (buffer.Length == 0) return Problem(400, "empty_trajectory", "There was nothing to store.");
            if (buffer.Length > 8 * 1024 * 1024)
                return Problem(413, "trajectory_too_large", "That recording is too large to store.");
            var hash = await store.PutAsync(buffer.ToArray(), ct);
            return Results.Ok(new { hash });
        });

        // Immutable by construction — the name *is* the content — so it can be cached for ever.
        api.MapGet("/trajectories/{hash}", async (string hash, ITrajectoryStore store, CancellationToken ct) =>
        {
            var stream = await store.OpenAsync(hash, ct);
            if (stream is null) return Problem(404, "trajectory_not_found", "That recording is not here.");
            return Results.Stream(stream, "application/octet-stream");
        }).WithMetadata(new ResponseCacheAttribute { Duration = 31_536_000 });
    }
}
