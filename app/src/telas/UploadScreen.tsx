import React, { useState } from 'react';
import { View, Button, Text } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import axios from 'axios';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

type Props = NativeStackScreenProps<any>;

export default function UploadScreen({ navigation }: Props) {
  const [status, setStatus] = useState('');

  const pickAndUpload = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf' });
    if (res.type !== 'success') return;
    const uri = res.uri;
    const formData = new FormData();
    // @ts-ignore
    formData.append('file', { uri, name: 'exame.pdf', type: 'application/pdf' });
    formData.append('patientName', 'Silvia'); // opcional, virá do form

    setStatus('Enviando...');
    try {
      const resp = await axios.post('http://SEU_BACKEND:4000/api/upload/pdf', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setStatus('Pronto — recebendo sugestões');
      // navegar para tela de edição com os dados retornados
      navigation.navigate('Edit', { data: resp.data });
    } catch (err: any) {
      console.error(err);
      setStatus('Erro no upload');
    }
  };

  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: 20 }}>
      <Button title="Selecionar PDF do exame" onPress={pickAndUpload} />
      <Text style={{ marginTop: 12 }}>{status}</Text>
    </View>
  );
}
