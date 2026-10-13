/** Metro's `require.context` (Expo turns it on for expo-router): a directory's matching modules, each evaluated when first called. */
interface NodeRequire {
  context(directory: string, recursive: boolean, filter: RegExp): { (id: string): unknown; keys(): string[] }
}
