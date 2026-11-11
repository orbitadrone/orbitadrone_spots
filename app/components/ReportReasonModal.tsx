import React from 'react';
import CheckBox from '@react-native-community/checkbox';
import {
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import {palette, radii, shadows} from '../../src/constants/theme';

export type ReportReasonOption = {
  key: string;
  label: string;
};

type ReportReasonModalProps = {
  visible: boolean;
  title: string;
  description: string;
  options: ReportReasonOption[];
  selectedReasons: Record<string, boolean>;
  notes: string;
  notesPlaceholder: string;
  cancelLabel: string;
  submitLabel: string;
  onToggleReason: (key: string) => void;
  onChangeNotes: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
};

const checkboxTintColors = {
  true: palette.highlight,
  false: '#ccc',
};

const ReportReasonModal = ({
  visible,
  title,
  description,
  options,
  selectedReasons,
  notes,
  notesPlaceholder,
  cancelLabel,
  submitLabel,
  onToggleReason,
  onChangeNotes,
  onClose,
  onSubmit,
}: ReportReasonModalProps) => (
  <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
    <View style={styles.overlay}>
      <View style={styles.content}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description}>{description}</Text>
        {options.map(option => (
          <View key={option.key} style={styles.checkboxRow}>
            <CheckBox
              value={Boolean(selectedReasons[option.key])}
              onValueChange={() => onToggleReason(option.key)}
              tintColors={checkboxTintColors}
            />
            <Text style={styles.checkboxLabel}>{option.label}</Text>
          </View>
        ))}
        <TextInput
          style={styles.notesInput}
          placeholder={notesPlaceholder}
          placeholderTextColor={palette.textMuted}
          value={notes}
          onChangeText={onChangeNotes}
          multiline
        />
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionButton, styles.cancelButton]}
            onPress={onClose}>
            <Text style={styles.cancelText}>{cancelLabel}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.submitButton]}
            onPress={onSubmit}>
            <Text style={styles.submitText}>{submitLabel}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  </Modal>
);

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  content: {
    width: '100%',
    backgroundColor: palette.backgroundCard,
    borderRadius: radii.xl,
    padding: 20,
    borderWidth: 1,
    borderColor: palette.borderLight,
    ...shadows.subtle,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center',
    color: palette.textPrimary,
  },
  description: {
    fontSize: 14,
    color: palette.textSecondary,
    marginBottom: 16,
    textAlign: 'center',
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  checkboxLabel: {
    marginLeft: 12,
    fontSize: 15,
    color: palette.textPrimary,
    flex: 1,
    flexWrap: 'wrap',
  },
  notesInput: {
    minHeight: 90,
    borderWidth: 1,
    borderColor: palette.borderLight,
    borderRadius: radii.md,
    paddingHorizontal: 10,
    paddingVertical: 8,
    textAlignVertical: 'top',
    color: palette.textPrimary,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 18,
  },
  actionButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: radii.md,
    marginLeft: 8,
  },
  cancelButton: {
    backgroundColor: palette.backgroundLight,
  },
  submitButton: {
    backgroundColor: palette.highlight,
  },
  cancelText: {
    color: palette.textSecondary,
    fontWeight: '600',
  },
  submitText: {
    color: '#fff',
    fontWeight: '600',
  },
});

export default React.memo(ReportReasonModal);
