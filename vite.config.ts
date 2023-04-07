import { defineConfig } from 'vite';

import { libConfig } from './src/vite-lib-config.js';


export default defineConfig(async () => {
	return { ...await libConfig() };
});
