import React, { useEffect, useRef } from 'react';
import { View, Image, Animated, Dimensions, StatusBar } from 'react-native';

const { width } = Dimensions.get('window');

interface SplashScreenProps {
  onFinish?: () => void;
}

export default function SplashScreen({ onFinish }: SplashScreenProps) {
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.85)).current;
  const glowOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.delay(200),
      Animated.parallel([
        Animated.timing(logoOpacity, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.spring(logoScale, {
          toValue: 1,
          friction: 6,
          tension: 80,
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(glowOpacity, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }),
      Animated.delay(1200),
      Animated.timing(logoOpacity, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onFinish?.();
    });
  }, []);

  return (
    <View className="flex-1 bg-black items-center justify-center">
      <StatusBar barStyle="light-content" backgroundColor="#000000" />

      <Animated.View
        style={{
          opacity: logoOpacity,
          transform: [{ scale: logoScale }],
          width: width * 0.85,
          alignItems: 'center',
        }}
      >
        <Image
          source={require('../assets/Final_Logo.png')}
          style={{
            width: width * 0.85,
            height: undefined,
            aspectRatio: 3.2,
          }}
          resizeMode="contain"
        />
      </Animated.View>
    </View>
  );
}