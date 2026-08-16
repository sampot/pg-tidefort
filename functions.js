export default {
  async fetch(request) {
    return Response.json({
      ok: true,
      name: "pg-tidefort",
      path: new URL(request.url).pathname,
    });
  },
};
