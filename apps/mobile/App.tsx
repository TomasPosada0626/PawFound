import "./global.css";

import { StatusBar } from "expo-status-bar";
import { Text, View } from "react-native";

export default function App() {
  return (
    <View className="flex-1 items-center justify-center bg-white">
      <Text className="text-2xl font-medium text-navy">
        Paw<Text className="text-teal">Found</Text>
      </Text>
      <Text className="mt-2 text-base text-gray-500">
        Conectamos patas, reunimos familias
      </Text>
      <StatusBar style="auto" />
    </View>
  );
}
