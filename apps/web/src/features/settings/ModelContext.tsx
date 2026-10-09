"use client";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
export type ModelProfile = "bonsai" | "qwen";
const Context = createContext<{
  model: ModelProfile;
  choose: (value: ModelProfile) => void;
} | null>(null);
export function ModelProvider({ children }: { children: ReactNode }) {
  const [model, setModel] = useState<ModelProfile>("bonsai");
  useEffect(() => {
    try {
      const value = localStorage.getItem("arogya-model-profile");
      if (value === "bonsai" || value === "qwen") setModel(value);
    } catch {}
  }, []);
  function choose(value: ModelProfile) {
    setModel(value);
    try {
      localStorage.setItem("arogya-model-profile", value);
    } catch {}
  }
  return (
    <Context.Provider value={{ model, choose }}>{children}</Context.Provider>
  );
}
export function useModel() {
  const value = useContext(Context);
  if (!value) throw new Error("ModelProvider is missing");
  return value;
}
