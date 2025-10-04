import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import UploadScreen from './src/telas/UploadScreen';
import EditScreen from './src/telas/EditScreen';

// 1) Defina o param list
export type RootStackParamList = {
  Upload: undefined;
  Edit: {
    tests: { label: string; value?: number; unit?: string; confidence?: number }[];
    patientName?: string; // ✅ adicionado
  };
   Receituario: {
    patientName?: string;
    suggested?: {
      supplements?: string[];
      fitoterapia?: string[];
      dieta?: string[];
      exercicios?: string[];
      estiloVida?: string[];
 
  };   };
}

// 2) Tipar o Stack com o param list
const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Upload">
        <Stack.Screen name="Upload" component={UploadScreen} options={{ title: 'Enviar Exame' }} />
        <Stack.Screen name="Edit" component={EditScreen} options={{ title: 'Receituário' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
