import fs from 'fs';

import { genToArray } from './gen-to-array.js';
import { getFiles } from './get-files.js';


export const getImportPaths = (filepath: string, excludePrefix?: string) => {
	const fileContent = fs.readFileSync(filepath, { encoding: 'utf8' });
	const paths = new Set<string>();

	const wildImports = fileContent.matchAll(/import (['"].+?['"])/gs);
	const normalImports = fileContent.matchAll(/import .+? from (.+?);/gs);
	const dynamicImports = fileContent.matchAll(/import\((.+?)\)/gs);

	[ ...wildImports, ...normalImports, ...dynamicImports ].forEach(ent => {
		const [ , capture ] = [ ...ent ];
		const trimmed = capture!.slice(1, -1);

		if (excludePrefix) {
			if (trimmed.startsWith(excludePrefix))
				return;
		}

		paths.add(capture!.slice(1, -1));
	});

	return [ ...paths ];
};


export const getAllExternalImportPaths = async (from: string, exclude: string[] = []) => {
	const pathSet = new Set<string>();
	let files = (await genToArray(getFiles(from)));
	for (const file of files)
		getImportPaths(file, '.').forEach(path => pathSet.add(path));

	exclude.forEach(name => pathSet.delete(name));

	return [ ...pathSet ];
};
