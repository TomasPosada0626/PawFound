import { Redirect, useLocalSearchParams } from "expo-router";

/** Enlace del SMS de Alerta Ángel (https://pawfound.app/alerta/angel/<id>) → detalle del caso. */
export default function AngelAlertLink() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Redirect href={`/pet/${encodeURIComponent(id ?? "")}`} />;
}
