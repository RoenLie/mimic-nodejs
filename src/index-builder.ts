import { ExportDeclaration, parse as swcParse } from '@swc/core';
import fs from 'fs';
import { parse, resolve } from 'path';

import { genToArray } from './gen-to-array.js';
import { getFiles } from './get-files.js';


/**
 * Builds a `targetFile` with exports from imports found in files accepted by the `pathMatchers`.
 */
export const indexBuilder = async (
	targetFile: string,
	pathMatchers: ((path: string) => boolean)[],
	options?: {
		/** @default `@internalexport` */
		exclusionJSDocTag?: string;
	},
) => {
	type Exports = {
		symbols: string[],
		types: string[],
		path: string,
	}

	/* destructured options */
	const { exclusionJSDocTag = '@internalexport' } = options ?? {};

	/* Get the location of where this script is run from */
	const projectRoot = resolve();

	/* Resolve target */
	const pathTarget = resolve(projectRoot, targetFile);

	/* Get the target directory path, for use in creating relative paths */
	const dirTarget = parse(pathTarget).dir;

	/* Retrieve, map, filter and sort the file paths */
	const filePaths = (await genToArray(getFiles(dirTarget, /\.ts/)))
		.map(rawPath => ({ rawPath, path: rawPath.replaceAll('\\', '/') }))
		.filter(({ path }) => pathMatchers.some(fn => fn(path)));

	/** Creates the regex used to check if an export contains an `@internal` flag */
	const createInternalRegex = (value: string) => new RegExp('\\/\\*\\*.+?' + exclusionJSDocTag + '.+?' + value, 's');

	/* Extract exports from the files through ast parsing. */
	const exports = await Promise.all(filePaths.map<Promise<Exports>>(async ({ rawPath, path }) => {
		const content: string = await fs.promises.readFile(rawPath, { encoding: 'utf8' });
		const ast = await swcParse(content, { syntax: 'typescript', decorators: true, comments: true, target: 'es2022' });

		const exportDeclarations = ast.body.filter((entry): entry is ExportDeclaration => entry.type === 'ExportDeclaration');
		const symbols = exportDeclarations
			.filter(({ declaration }) =>
				declaration.type === 'ClassDeclaration' ||
				declaration.type === 'FunctionDeclaration' ||
				declaration.type === 'VariableDeclaration')
			.map(({ declaration }) => {
				if (declaration.type === 'ClassDeclaration') {
					return declaration.identifier.value;
				}
				else if (declaration.type === 'FunctionDeclaration') {
					return declaration.identifier.value;
				}
				else if (declaration.type === 'VariableDeclaration') {
					const varDeclarations = declaration.declarations.map(dec => {
						if (dec.id.type === 'Identifier')
							return dec.id.value;
					}).filter(Boolean).join(',');

					return varDeclarations;
				}
				else {
					throw new Error(`Unsupported declaration.type='${ declaration.type }'`);
				}
			}).filter(value => {
				// filter out any exports with a jsdoc @internal
				return !createInternalRegex(value).test(content);
			});

		const types = exportDeclarations
			.filter(({ declaration }) =>
				declaration.type === 'TsTypeAliasDeclaration' ||
				declaration.type === 'TsInterfaceDeclaration' ||
				declaration.type === 'TsModuleDeclaration')
			.map(({ declaration }) => {
				switch (declaration.type) {
				case 'TsTypeAliasDeclaration':
				case 'TsInterfaceDeclaration':
				case 'TsModuleDeclaration':
					return declaration.id.value;
				default:
					throw new Error(`Unsupported declaration.type='${ declaration.type }'`);
				}
			}).filter(value => {
				// filter out any exports with a jsdoc @internal
				return !createInternalRegex(value).test(content);
			});

		return {
			symbols,
			types,
			path,
		};
	}));

	/* Create the file content of the symbols */
	const symbolLines = exports.filter(({ symbols }) => symbols.length > 0).map(({ symbols, path }) => {
		return { path, line: `export { ${ symbols.join(', ') } } from '${ path.replace('.ts', '.js') }';` };
	});

	/* Create the file content of the types */
	const typeLines = exports.filter(({ types }) => types.length > 0).map(({ types, path }) => {
		return { path, line: `export type { ${ types.join(', ') } } from '${ path.replace('.ts', '.js') }';` };
	});

	/* Sorts on path and picks the line */
	const lines = [ ...symbolLines, ...typeLines ]
		.sort((entryA, entryB) => entryA.path > entryB.path ? 1 : -1)
		.map(({ line }) => line.replace(dirTarget.replaceAll('\\', '/'), '.'));

	/* Check if there is an existing index file, and retrieve the contents */
	fs.mkdirSync(dirTarget, { recursive: true });
	const existingIndex = fs.existsSync(pathTarget) ? await fs.promises.readFile(pathTarget, { encoding: 'utf8' }) : '';
	const existingLines = existingIndex.split('\n').filter(l => l.startsWith('export'));

	/* compares two arrays and returns if they have the same entries, does not care about sort */
	const arrayEqualEntries = (a: string[], b: string[]) => {
		const sameNumberOfEntries = a.length === b.length;
		const cacheHasSameEntries = a.every(cache => b.includes(cache));

		return sameNumberOfEntries && cacheHasSameEntries;
	};

	/* only write the index file if it is different from what exists */
	const filesEqual = arrayEqualEntries(lines, existingLines);
	if (!filesEqual) {
		lines.sort((a, b) => {
			let aSort = a.length;
			let bSort = b.length;

			if (a.includes('export type'))
				aSort = aSort + 1000;
			if (b.includes('export type'))
				bSort = bSort + 1000;

			return bSort - aSort;
		});

		console.log('\n', 'create-index: Index updated');

		lines.unshift('/* auto generated */');
		lines.unshift('/* eslint-disable max-len */');
		lines.unshift('/* eslint-disable simple-import-sort/exports */');
		lines.push('');

		/* Write the new index file. */
		await fs.promises.writeFile(pathTarget, lines.join('\n'));
	}
};
