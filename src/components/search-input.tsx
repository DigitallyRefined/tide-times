import React, { useState, useMemo } from "react";
import {
  View,
  TextInput,
  Pressable,
  Text,
  StyleSheet,
  type TextInputProps,
} from "react-native";
import { useTheme } from "@/hooks/use-theme";
import { Spacing } from "@/constants/theme";

type SearchInputProps = Omit<TextInputProps, "value" | "onChangeText"> & {
  value?: string;
  onChangeText?: (text: string) => void;
};

export default function SearchInput({
  value: controlledValue,
  onChangeText,
  ...props
}: SearchInputProps) {
  const colors = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [internalValue, setInternalValue] = useState("");

  const value = controlledValue ?? internalValue;

  const handleChangeText = (text: string) => {
    if (controlledValue === undefined) {
      setInternalValue(text);
    }

    onChangeText?.(text);
  };

  const clear = () => {
    handleChangeText("");
  };

  return (
    <View style={styles.container}>
      <TextInput
        placeholder="Search..."
        {...props}
        value={value}
        onChangeText={handleChangeText}
        style={[styles.input, props.style]}
      />

      {value.length > 0 && (
        <Pressable
          onPress={clear}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          style={styles.clearButton}
        >
          <Text style={styles.clear}>×</Text>
        </Pressable>
      )}
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    container: {
      backgroundColor: colors.backgroundElement,
      flexDirection: "row",
      alignItems: "center",
      borderWidth: 1,
      borderColor: "#ccc",
      borderRadius: 8,
      paddingHorizontal: 10,
    },
    input: {
      flex: 1,
      backgroundColor: colors.backgroundElement,
      color: colors.text,
      borderRadius: 12,
      paddingHorizontal: Spacing.three,
      paddingVertical: Spacing.three,
      fontSize: 16,
      textAlignVertical: "center",
      includeFontPadding: false,
    },
    clearButton: {
      paddingLeft: 8,
    },
    clear: {
      fontSize: 24,
      color: "#666",
    },
  });
}
