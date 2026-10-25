import { CardSearch } from "@/components/editor/CardSearch";
import { useSearchParams } from "react-router-dom";

export default function Search() {
  const [params, setParams] = useSearchParams();
  const setCode = params.get("set") ?? "";
  return (
    <div className="h-full min-h-0 min-w-0 w-full overflow-hidden">
      <CardSearch
        key={setCode}
        standalone
        initialSet={setCode}
        onSetChange={(code) => {
          setParams((current) => {
            if (code) current.set("set", code);
            else current.delete("set");
            return current;
          });
        }}
      />
    </div>
  );
}
