import { Redirect, useLocalSearchParams } from "expo-router";

/** Enlace público para compartir (https://pawfound.pages.dev/mascota/<id>) → detalle del caso. */
export default function SharedPetLink() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Redirect href={`/pet/${encodeURIComponent(id ?? "")}`} />;
}
