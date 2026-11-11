import {StyleSheet} from 'react-native';

import {palette, radii, shadows} from '../../../src/constants/theme';

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: palette.background,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  topTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: palette.textPrimary,
  },
  refreshButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: palette.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.sm,
  },
  sectionTabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  sectionTab: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.full,
    backgroundColor: palette.surface,
  },
  sectionTabActive: {
    backgroundColor: palette.highlight,
  },
  sectionTabText: {
    color: palette.textSecondary,
    fontWeight: '600',
  },
  sectionTabTextActive: {
    color: '#fff',
  },
  searchBoxWrapper: {
    marginHorizontal: 16,
    marginBottom: 12,
    paddingHorizontal: 12,
    borderRadius: radii.full,
    backgroundColor: palette.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 10,
    color: palette.textPrimary,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  centeredState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 20,
    backgroundColor: palette.background,
  },
  stateTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: palette.textPrimary,
  },
  stateText: {
    textAlign: 'center',
    color: palette.textSecondary,
  },
  sectionContainer: {
    gap: 12,
  },
  sectionHeaderRow: {
    gap: 12,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: palette.textPrimary,
  },
  dashboardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  dashboardCard: {
    width: '47%',
    padding: 14,
    borderRadius: radii.lg,
    backgroundColor: palette.surface,
    ...shadows.sm,
  },
  dashboardValue: {
    fontSize: 24,
    fontWeight: '800',
    color: palette.highlight,
  },
  dashboardLabel: {
    marginTop: 4,
    color: palette.textSecondary,
  },
  inlineFilterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  inlineFilter: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.full,
    backgroundColor: palette.surface,
  },
  inlineFilterActive: {
    backgroundColor: palette.highlight,
  },
  inlineFilterText: {
    color: palette.textSecondary,
    fontWeight: '600',
  },
  inlineFilterTextActive: {
    color: '#fff',
  },
  listCard: {
    padding: 14,
    borderRadius: radii.lg,
    backgroundColor: palette.surface,
    gap: 10,
    ...shadows.sm,
  },
  spotTopRow: {
    flexDirection: 'row',
    gap: 12,
  },
  spotThumb: {
    width: 76,
    height: 76,
    borderRadius: radii.md,
    backgroundColor: palette.border,
  },
  spotThumbFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  spotMainInfo: {
    flex: 1,
    gap: 4,
  },
  listCardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: palette.textPrimary,
  },
  listCardMeta: {
    color: palette.textSecondary,
    fontSize: 13,
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  actionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.full,
    backgroundColor: '#E9EEF6',
  },
  actionPillDanger: {
    backgroundColor: '#D64545',
  },
  actionPillText: {
    color: palette.textPrimary,
    fontWeight: '700',
  },
  actionPillDangerText: {
    color: '#fff',
  },
  commentBody: {
    color: palette.textPrimary,
    lineHeight: 20,
  },
  statusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statusButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radii.full,
    backgroundColor: '#E9EEF6',
  },
  statusButtonActive: {
    backgroundColor: palette.highlight,
  },
  statusButtonText: {
    fontWeight: '700',
    color: palette.textPrimary,
  },
  statusButtonTextActive: {
    color: '#fff',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: {
    maxHeight: '85%',
    borderRadius: radii.xl,
    backgroundColor: palette.background,
    padding: 16,
    gap: 12,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '800',
    color: palette.textPrimary,
    marginRight: 12,
  },
  modalMeta: {
    color: palette.textSecondary,
    marginBottom: 4,
  },
  modalImage: {
    width: 140,
    height: 100,
    borderRadius: radii.md,
    marginRight: 10,
  },
  modalVideoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalDescription: {
    color: palette.textPrimary,
    lineHeight: 21,
  },
  modalSubTitle: {
    marginTop: 12,
    marginBottom: 6,
    fontSize: 15,
    fontWeight: '800',
    color: palette.textPrimary,
  },
  modalCommentRow: {
    marginBottom: 10,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
  },
  commentAuthor: {
    fontWeight: '800',
    color: palette.textPrimary,
    marginBottom: 4,
  },
});
