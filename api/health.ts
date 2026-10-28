export function GET() {
  return Response.json(
    {
      service: "ci-runner-selection",
      configured: Boolean(
        process.env["GITHUB_APP_ID"] && process.env["GITHUB_APP_PRIVATE_KEY"],
      ),
    },
    {
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
