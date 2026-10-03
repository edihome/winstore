import { useCallback, useEffect, useState } from "react";
import apiClient from "../../api/client";

const identity = (row) => row;

// Both financial APIs return complete lists. Cancel obsolete requests and
// hide a previous branch/register's rows as soon as the query changes.
export function useFinanceRows(path, params = {}, mapRow = identity) {
  const paramsKey = JSON.stringify(params);
  const requestKey = `${path}:${paramsKey}`;
  const [result, setResult] = useState({ key: "", rows: [], loading: true, error: "" });
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    if (!path) return undefined;
    const controller = new AbortController();
    let cancelled = false;
    setResult((previous) => ({
      key: requestKey,
      rows: previous.key === requestKey ? previous.rows : [],
      loading: true,
      error: "",
    }));
    apiClient.get(path, { params: JSON.parse(paramsKey), signal: controller.signal })
      .then((response) => {
        if (!Array.isArray(response.data.data)) throw new Error("The records could not be read. Please refresh.");
        if (!cancelled) setResult({ key: requestKey, rows: response.data.data.map(mapRow), loading: false, error: "" });
      })
      .catch((error) => {
        if (!cancelled) setResult({ key: requestKey, rows: [], loading: false, error: error.message });
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [path, paramsKey, requestKey, mapRow, revision]);

  return {
    rows: path && result.key === requestKey ? result.rows : [],
    loading: Boolean(path) && (result.key !== requestKey || result.loading),
    error: path && result.key === requestKey ? result.error : "",
    reload,
  };
}
