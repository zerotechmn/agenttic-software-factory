import { API, HealthResponse } from "../../shared/contracts.ts";
import { api } from "../lib/api.ts";
import { useAsync } from "../lib/useAsync.ts";
import { Card } from "../components/ui/Card.tsx";
import { Badge } from "../components/ui/Badge.tsx";

export function Home() {
  const { data, error, loading } = useAsync(() => api(HealthResponse, API.health));
  return (
    <Card>
      <h1 className="text-2xl font-semibold">Welcome</h1>
      <p className="mt-2 text-muted">This app was assembled by FORGE.</p>
      <div className="mt-4">
        {loading && <Badge>checking…</Badge>}
        {error && <Badge tone="danger">API error: {error}</Badge>}
        {data && <Badge tone="success">API online · {data.product}</Badge>}
      </div>
    </Card>
  );
}
