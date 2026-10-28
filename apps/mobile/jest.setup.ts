/* eslint-disable @typescript-eslint/no-require-imports */
// Mocks de módulos nativos para Jest. Los flujos completos se prueban con renderRouter
// (expo-router/testing-library) sobre estos dobles; en dispositivo los cubre Maestro (e2e/).

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

// Idioma del dispositivo: español (predeterminado del producto). Los tests de inglés lo cambian.
jest.mock("expo-localization", () => ({
  getLocales: () => [{ languageCode: "es", languageTag: "es-CO" }],
}));

jest.mock("@expo-google-fonts/nunito", () => ({
  useFonts: () => [true, null],
  Nunito_400Regular: 1,
  Nunito_600SemiBold: 1,
  Nunito_700Bold: 1,
  Nunito_800ExtraBold: 1,
  Nunito_900Black: 1,
}));

// Doble en __mocks__/react-native-maps.tsx (los factories de jest.mock no pueden usar JSX con NativeWind).
jest.mock("react-native-maps");

jest.mock("expo-location", () => ({
  Accuracy: { Balanced: 3 },
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  getForegroundPermissionsAsync: jest.fn(async () => ({ status: "undetermined" })),
  getCurrentPositionAsync: jest.fn(async () => ({ coords: { latitude: 6.2449, longitude: -75.5912 } })),
  reverseGeocodeAsync: jest.fn(async () => [{ district: "Laureles", city: "Medellín", subregion: null, street: null }]),
}));

jest.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true })),
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: false, assets: [{ uri: "file:///photo.jpg" }] })),
  launchCameraAsync: jest.fn(async () => ({ canceled: false, assets: [{ uri: "file:///camera.jpg" }] })),
}));

jest.mock("expo-haptics", () => ({
  notificationAsync: jest.fn(async () => {}),
  impactAsync: jest.fn(async () => {}),
  NotificationFeedbackType: { Success: "success", Error: "error" },
  ImpactFeedbackStyle: { Light: "light" },
}));
