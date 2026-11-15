import React, { useState } from 'react';
import { libraryStrings } from '../../screens/libraryStrings';
import { playlistUpdateRequest } from '../../screens/libraryModel';
import { playlistFailureMessage, playlistNameValidation } from '../../screens/playlistFeedback';
import { PlaylistFormSheet } from './PlaylistFormSheet';
import type { PlaylistMutations } from './usePlaylistMutations';

export interface PlaylistEditForm {
  visible: boolean;
  name: string;
  description: string;
  /** Localized validation or save failure; null while the form is clean. */
  error: string | null;
  busy: boolean;
  setName: (value: string) => void;
  setDescription: (value: string) => void;
  /** Opens the form pre-filled with the playlist's current values. */
  open: (current: { name: string; description: string | null }) => void;
  close: () => void;
  submit: (playlistId: number) => void;
}

/** Form state of the rename/description sheet on top of the update mutation. */
export function usePlaylistEditForm(update: PlaylistMutations['update']): PlaylistEditForm {
  const [visible, setVisible] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [validation, setValidation] = useState<string | null>(null);

  return {
    visible,
    name,
    description,
    error:
      validation ??
      (update.error !== null ? playlistFailureMessage('mutation', update.error) : null),
    busy: update.isPending,
    setName,
    setDescription,
    open: (current) => {
      setName(current.name);
      setDescription(current.description ?? '');
      setValidation(null);
      setVisible(true);
    },
    close: () => {
      if (update.isPending) return;
      setVisible(false);
      setValidation(null);
    },
    submit: (playlistId) => {
      const invalid = playlistNameValidation(name);
      setValidation(invalid);
      if (invalid !== null) return;
      update.reset();
      try {
        update.mutate(
          { id: playlistId, patch: playlistUpdateRequest(name, description) },
          {
            // Runs after the hook-level cache refresh, so the sheet closes on fresh data.
            onSuccess: () => {
              setVisible(false);
              setValidation(null);
            },
          },
        );
      } catch (error) {
        setValidation(playlistFailureMessage('mutation', error));
      }
    },
  };
}

export interface PlaylistEditSheetProps {
  form: PlaylistEditForm;
  onSubmit: () => void;
}

/** Rename / re-describe a playlist; shares the form with "create playlist". */
export function PlaylistEditSheet({ form, onSubmit }: PlaylistEditSheetProps) {
  return (
    <PlaylistFormSheet
      visible={form.visible}
      testIDPrefix="playlist-edit"
      title={libraryStrings.playlist.editTitle}
      name={form.name}
      description={form.description}
      error={form.error}
      busy={form.busy}
      submitLabel={libraryStrings.common.save}
      busyLabel={libraryStrings.common.saving}
      submitIcon="check"
      onNameChange={form.setName}
      onDescriptionChange={form.setDescription}
      onClose={form.close}
      onSubmit={onSubmit}
    />
  );
}
