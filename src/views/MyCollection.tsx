import { useMemo, useRef, useState } from "react";
import { Download, LibraryBig, Search, Upload } from "lucide-react";
import { Navigate } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCardCollection } from "@/hooks/useCardCollection";
import { ROUTES } from "@/lib/constants";
import { useAuthStore } from "@/stores/useAuthStore";
import { useCollectionStore } from "@/stores/useCollectionStore";

function parseCollection(text: string): Record<string, number> {
  const quantities: Record<string, number> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^quantity[,\t]/i.test(line)) continue;
    const csv = line.match(/^(\d+)[,\t](?:"([^"]+)"|(.+))$/);
    const plain = line.match(/^(\d+)\s+x?\s+(.+)$/i);
    const quantity = Number(csv?.[1] ?? plain?.[1]);
    const name = (csv?.[2] ?? csv?.[3] ?? plain?.[2] ?? "").trim().replace(/^"|"$/g, "");
    if (name && Number.isFinite(quantity)) quantities[name.toLowerCase()] = quantity;
  }
  return quantities;
}

export default function MyCollection() {
  useCardCollection();
  const authStatus = useAuthStore((state) => state.status);
  const quantities = useCollectionStore((state) => state.quantities);
  const setQuantity = useCollectionStore((state) => state.setQuantity);
  const replaceQuantities = useCollectionStore((state) => state.replaceQuantities);
  const loading = useCollectionStore((state) => state.loading);
  const [query, setQuery] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const rows = useMemo(
    () =>
      Object.entries(quantities)
        .filter(([name]) => name.includes(query.trim().toLowerCase()))
        .sort((a, b) => a[0].localeCompare(b[0])),
    [quantities, query],
  );

  if (authStatus === "unknown") return null;
  if (authStatus !== "signedIn") return <Navigate to={ROUTES.SETTINGS} replace />;

  async function importFile(file: File) {
    const imported = parseCollection(await file.text());
    if (Object.keys(imported).length === 0) {
      toast.error("No collection rows were found in that file.");
      return;
    }
    await replaceQuantities(imported);
    toast.success(`Imported ${Object.keys(imported).length} cards`);
  }

  function exportCollection() {
    const csv = [
      "Quantity,Card Name",
      ...Object.entries(quantities)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([name, quantity]) => `${quantity},"${name.replaceAll('"', '""')}"`),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "manabrew-collection.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <LibraryBig className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-semibold">My Collection</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {loading
              ? "Syncing with your account…"
              : `${Object.keys(quantities).length} unique cards`}
          </p>
        </div>
        <div className="flex gap-2">
          <input
            ref={fileInput}
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importFile(file);
              event.target.value = "";
            }}
          />
          <Button variant="outline" onClick={() => fileInput.current?.click()}>
            <Upload className="mr-1.5 h-4 w-4" /> Import
          </Button>
          <Button variant="outline" disabled={rows.length === 0} onClick={exportCollection}>
            <Download className="mr-1.5 h-4 w-4" /> Export CSV
          </Button>
        </div>
      </div>

      <div className="relative mt-6 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          value={query}
          placeholder="Search your collection"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border">
        {rows.map(([name, quantity]) => (
          <label key={name} className="flex items-center gap-4 border-b px-4 py-3 last:border-b-0">
            <span className="min-w-0 flex-1 capitalize">{name}</span>
            <span className="text-xs text-muted-foreground">Owned</span>
            <Input
              type="number"
              min="0"
              className="h-8 w-20 text-right font-mono"
              value={quantity}
              aria-label={`Owned copies of ${name}`}
              onChange={(event) => void setQuantity(name, Number(event.target.value))}
            />
          </label>
        ))}
        {!loading && rows.length === 0 && (
          <div className="px-4 py-16 text-center text-sm text-muted-foreground">
            {query
              ? "No cards match your search."
              : "Import a CSV or text list to start your collection."}
          </div>
        )}
      </div>
    </main>
  );
}
