import { useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { PlaylistSummary } from '../../api/types';
import { musicMutations, queryKeys } from '../../data';
import { playlistCreateRequest } from '../../screens/libraryModel';
import { libraryStrings } from '../../screens/libraryStrings';
import { playlistFailureMessage, playlistNameValidation } from '../../screens/playlistFeedback';
import { refreshAutoBrowse } from './autoBrowse';

export interface CreatePlaylistForm {
  visible: boolean;
  name: string;
  description: string;
  isCollaborative: boolean;
  /** Localized validation or request failure; null while the form is clean. */
  error: string | null;
  busy: boolean;
  setName: (value: string) => void;
  setDescription: (value: string) => void;
  setIsCollaborative: (value: boolean) => void;
  open: () => void;
  close: () => void;
  submit: () => void;
}

/**
 * Owns the create-playlist form and its mutation: validation, the request,
 * cache + car-library refresh, the screen-reader announcement and the
 * hand-over of the created playlist to `onCreated`.
 */
export function useCreatePlaylist(
  scope: string,
  onCreated: (playlist: Pick<PlaylistSummary, 'id' | 'name'>) => void,
): CreatePlaylistForm {
  const queryClient = useQueryClient();
  const [visible, setVisible] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isCollaborative, setIsCollaborative] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);

  const mutation = useMutation({
    ...musicMutations.createPlaylist(scope),
    onSuccess: async (created) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.playlists.owned(scope) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.playlists.public(scope) }),
        refreshAutoBrowse(),
      ]);
      setVisible(false);
      setName('');
      setDescription('');
      setIsCollaborative(false);
      setValidation(null);
      AccessibilityInfo.announceForAccessibility(libraryStrings.library.created(created.name));
      onCreated({ id: created.id, name: created.name });
    },
  });

  return {
    visible,
    name,
    description,
    isCollaborative,
    error: validation ?? (mutation.error !== null ? libraryStrings.library.createFailed : null),
    busy: mutation.isPending,
    setName,
    setDescription,
    setIsCollaborative,
    open: () => {
      mutation.reset();
      setVisible(true);
    },
    close: () => {
      if (mutation.isPending) return;
      setVisible(false);
      setIsCollaborative(false);
      setValidation(null);
      mutation.reset();
    },
    submit: () => {
      const invalid = playlistNameValidation(name);
      setValidation(invalid);
      if (invalid !== null) return;
      mutation.reset();
      try {
        mutation.mutate(playlistCreateRequest(name, description, isCollaborative));
      } catch (error) {
        setValidation(playlistFailureMessage('create', error));
      }
    },
  };
}
