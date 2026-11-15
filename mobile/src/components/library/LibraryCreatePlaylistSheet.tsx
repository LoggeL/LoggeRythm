import React from 'react';
import { libraryStrings } from '../../screens/libraryStrings';
import { PlaylistFormSheet } from './PlaylistFormSheet';
import type { CreatePlaylistForm } from './useCreatePlaylist';

/** "New playlist" as a bottom sheet; the form itself is shared with "edit playlist". */
export function LibraryCreatePlaylistSheet({ form }: { form: CreatePlaylistForm }) {
  return (
    <PlaylistFormSheet
      visible={form.visible}
      testIDPrefix="library-create"
      title={libraryStrings.library.createTitle}
      name={form.name}
      description={form.description}
      error={form.error}
      busy={form.busy}
      submitLabel={libraryStrings.library.createPlaylist}
      busyLabel={libraryStrings.library.creating}
      submitIcon="plus"
      onNameChange={form.setName}
      onDescriptionChange={form.setDescription}
      onClose={form.close}
      onSubmit={form.submit}
    />
  );
}
