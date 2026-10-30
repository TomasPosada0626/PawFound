import { Image } from "react-native";

/** Lado mayor con el que se suben las fotos (el servidor guarda hasta 1600 px). */
const MAX_SIDE = 1600;

type Manipulator = typeof import("expo-image-manipulator");

function imageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => Image.getSize(uri, (width, height) => resolve({ width, height }), reject));
}

/**
 * Achica la foto antes de subirla: lado mayor de 1600 px y JPEG al 80 %, unos 300 KB en vez de
 * los 3 a 8 MB de una foto de cámara. Así sube en segundos con datos móviles y el servidor no
 * corta la conexión. Si el módulo no está (Expo Go o una app instalada antes de este cambio),
 * sube la foto tal cual.
 */
export async function shrinkPhoto(uri: string): Promise<string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ImageManipulator, SaveFormat } = require("expo-image-manipulator") as Manipulator;
    const { width, height } = await imageSize(uri);
    const context = ImageManipulator.manipulate(uri);
    if (Math.max(width, height) > MAX_SIDE) {
      context.resize(width >= height ? { width: MAX_SIDE } : { height: MAX_SIDE });
    }
    const image = await context.renderAsync();
    const saved = await image.saveAsync({ compress: 0.8, format: SaveFormat.JPEG });
    return saved.uri;
  } catch {
    return uri;
  }
}
