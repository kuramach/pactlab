import base from '@pactlab/config/eslint';

// The window and engine bundles and the shell's build output are generated (and git-ignored).
export default [{ ignores: ['dist/**', 'src-tauri/resources/**', 'src-tauri/binaries/**', 'src-tauri/vendor/**', 'src-tauri/target/**', 'src-tauri/gen/**'] }, ...base];
