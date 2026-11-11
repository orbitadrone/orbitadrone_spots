import React from 'react';
import {TouchableOpacity, Text, StyleSheet} from 'react-native';
import {palette, radii, shadows} from '../../src/constants/theme';

interface CustomButtonProps {
  title: string;
  onPress: () => void;
  color?: string;
  textColor?: string;
  style?: object;
  textStyle?: object;
  disabled?: boolean;
  variant?: 'solid' | 'outline';
}

const CustomButton: React.FC<CustomButtonProps> = ({
  title,
  onPress,
  color,
  textColor,
  style,
  textStyle,
  disabled = false,
  variant = 'solid',
}) => {
  const buttonBackgroundColor = color || palette.accent;
  const isOutline = variant === 'outline';

  const buttonTextColor = isOutline
    ? textColor || palette.accent
    : textColor || '#ffffff';

  const dynamicStyle = isOutline
    ? {
        backgroundColor: 'transparent',
        borderColor: color || palette.borderMuted,
        borderWidth: StyleSheet.hairlineWidth,
        opacity: disabled ? 0.6 : 1,
      }
    : {
        backgroundColor: buttonBackgroundColor,
        opacity: disabled ? 0.6 : 1,
      };

  return (
    <TouchableOpacity
      style={[
        styles.button,
        !isOutline && shadows.subtle,
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
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 100,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: palette.textPrimary,
  },
});

export default CustomButton;
