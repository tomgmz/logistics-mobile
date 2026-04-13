import { View, Text, StyleSheet } from 'react-native'

export default function DriverAssignment() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Driver Assignment</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontSize: 20,
  },
})