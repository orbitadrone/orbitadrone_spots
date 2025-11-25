import React from 'react';
import {TouchableOpacity, Text, StyleSheet} from 'react-native';

const Colors = {
  light: {
    primary: '#007bff',
    secondary: '#6c757d',
    accent: '#17a2b8',
    text: '#000',
    textDark: '#fff',
    tint: '#0a7ea4',
  },
  dark: {
    primary: '#007bff',
    secondary: '#6c757d',
    accent: '#17a2b8',
    text: '#fff',
    textDark: '#000',
    tint: '#0a7ea4',
  },
};

interface CustomButtonProps {
  title: string;
  onPress: () => void;
  color?: string;
  textColor?: string;
  style?: object;
  textStyle?: object;
  disabled?: boolean;
}

const CustomButton: React.FC<CustomButtonProps> = ({
  title,
  onPress,
  color,
  textColor,
  style,
  textStyle,
  disabled = false,
}) => {
  const theme = 'light';
  const buttonBackgroundColor = color || Colors[theme].primary;

  const buttonTextColor =
    buttonBackgroundColor === Colors[theme].primary ||
    buttonBackgroundColor === Colors[theme].secondary ||
    buttonBackgroundColor === Colors[theme].accent
      ? Colors[theme].textDark
      : textColor || Colors[theme].text;

  const dynamicStyle = {
    backgroundColor: buttonBackgroundColor,
    opacity: disabled ? 0.6 : 1,
  };

  return (
    <TouchableOpacity
      style={[
        styles.button,
        dynamicStyle,
        style,
      ]}
      onPress={onPress}
      activeOpacity={0.8}
      disabled={disabled}>
      <Text style={[styles.buttonText, {color: buttonTextColor}, textStyle]}>
        {title}
      </Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 100,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.1,
    shadowRadius: 1,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default CustomButton;
