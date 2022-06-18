import { promisify } from "util";
import { exec } from "child_process";
import gradient from "gradient-string";
import { sync as glob } from "fast-glob";
import { readFileSync, writeFileSync } from "fs-extra";
import { DEBUG_NAME, LOG_NAME } from "./constants";
import {
  CheckFiles,
  CodeDependencies,
  CheckMatches,
  CheckDependenciesForVersionOptions,
  PackageJSON,
  DepToUpdateItem,
  DepsToUpdate,
} from "./types";

/**
 * execPromise
 * @description interprets a cmd
 * @param {cmd} string
 * @returns {object}
 */
export const execPromise = promisify(exec);

/**
 * constructVersionMap
 * @description constructs a map of each item in a codependencies array
 * @param {codependencies} array
 * @param {exec} fn
 * @param {isDebugging} boolean
 * @returns {object}
 */
export const constructVersionMap = async (
  codependencies: CodeDependencies,
  exec = execPromise,
  isDebugging = false
) => {
  const updatedCodeDependencies = await Promise.all(
    codependencies.map(async (item) => {
      try {
        if (typeof item === "object" && Object.keys(item).length === 1) {
          return item;
        } else if (typeof item === "string" && item.length > 1) {
          const { stdout = "" } = (await exec(
            `npm view ${item} version latest`
          )) as unknown as Record<string, string>;
          const version = stdout.toString().replace("\n", "");
          if (version) return { [item]: version };
          throw `${version}`;
        } else {
          throw "invalid item";
        }
      } catch (err) {
        if (isDebugging)
          console.error(
            `${gradient.passion(
              `${DEBUG_NAME}:constructVersionMap:`
            )}\n   🤼‍♀️ => ${err}`
          );
        return {};
      }
    })
  );
  const versionMap = updatedCodeDependencies.reduce(
    (acc: Record<string, string> = {}, item: Record<string, string>) => {
      const [name] = Object.keys(item);
      const version = item?.[name];
      return { ...acc, ...(name && version ? { [name]: version } : {}) };
    },
    {}
  );
  return versionMap;
};

/**
 * constructVersionTypes
 * @description constructs an object with a bumpVersion and exactVersion
 * @param {version} string
 * @returns {object}
 */
export const constructVersionTypes = (
  version: string
): Record<string, string> => {
  const versionCharacters = version.split("");
  const [firstCharacter, ...rest] = versionCharacters;
  const specifier = ["^", "~"].includes(firstCharacter) ? firstCharacter : "";
  const hasSpecifier = specifier.length === 1;
  const characters = rest.join("");
  const exactVersion = hasSpecifier ? characters : version;
  const bumpVersion = version;
  return {
    bumpVersion,
    exactVersion,
  };
};

/**
 * constructDepsToUpdateList
 * @description returns an array of deps to update
 * @param {dep} object
 * @param {versionMap} object
 * @returns {array} example [{ name: 'foo', action: '1.0.0', expected: '1.1.0' }]
 */
export const constructDepsToUpdateList = (
  dep = {} as Record<string, string>,
  versionMap: Record<string, string>
): Array<DepToUpdateItem> => {
  if (!Object.keys(dep).length) return [];
  const versionList = Object.keys(versionMap);
  return Object.entries(dep)
    .map(([name, version]) => {
      const { exactVersion, bumpVersion } = constructVersionTypes(version);
      return { name, exactVersion, bumpVersion };
    })
    .filter(
      ({ name, exactVersion }) =>
        versionList.includes(name) && versionMap[name] !== exactVersion
    )
    .map(({ name, exactVersion, bumpVersion }) => ({
      name,
      actual: bumpVersion,
      exact: exactVersion,
      expected: versionMap[name],
    }));
};

/**
 * writeConsoleMsgs
 * @param {packageName} string
 * @param {depList} array
 * @returns void
 */
export const writeConsoleMsgs = (
  packageName: string,
  depList: Array<Record<string, string>>
): void => {
  if (!depList.length) return;
  Array.from(depList, ({ name: depName, expected, actual }) =>
    console.log(
      `${gradient.teen(
        `${packageName}:`
      )}\n   🤼‍♀️ => ${depName} version is not correct.\n   🤼‍♀️ => Found ${actual} and should be ${expected}`
    )
  );
};

/**
 * constructDeps
 * @description constructed deps with updates
 * @param {json} object
 * @param {depName} string
 * @param {depList} array
 * @returns {object}
 */
export const constructDeps = <T extends PackageJSON>(
  json: T,
  depName: string,
  depList: Array<DepToUpdateItem>
) =>
  depList?.length
    ? depList.reduce(
        (
          newJson: PackageJSON[
            | "dependencies"
            | "devDependencies"
            | "peerDependencies"],
          { name, exact: version }: DepToUpdateItem
        ) => {
          return {
            ...json[depName as keyof T],
            ...newJson,
            [name]: version,
          };
        },
        {}
      )
    : json[depName as keyof PackageJSON];

/**
 * constructJson
 * @description constructs json with updates
 * @param {json} object
 * @param {depsToUpdate} array
 * @param {isDebugging} boolean
 * @returns {object}}
 */
export const constructJson = <T extends PackageJSON>(
  json: T,
  depsToUpdate: DepsToUpdate,
  isDebugging = false
) => {
  const { depList, devDepList, peerDepList } = depsToUpdate;
  const dependencies = constructDeps(json, "dependencies", depList);
  const devDependencies = constructDeps(json, "devDependencies", devDepList);
  const peerDependencies = constructDeps(json, "peerDependencies", peerDepList);
  if (isDebugging) {
    console.log(gradient.passion(`${DEBUG_NAME}`), {
      dependencies,
      devDependencies,
      peerDependencies,
    });
  }
  return {
    ...json,
    ...(dependencies ? { dependencies } : {}),
    ...(devDependencies ? { devDependencies } : {}),
    ...(peerDependencies ? { peerDependencies } : {}),
  };
};

/**
 * checkDependenciesForVersion
 * @description checks dependencies for a mismatched version
 * @param {versionMap} object
 * @param {json} object
 * @param {isUpdating} boolean
 * @returns {boolean}
 */
export const checkDependenciesForVersion = <T extends PackageJSON>(
  versionMap: Record<string, string>,
  json: T,
  options: CheckDependenciesForVersionOptions
): boolean => {
  const { name, dependencies, devDependencies, peerDependencies } = json;
  const { isUpdating, isDebugging, isSilent, isTesting } = options;
  if (!dependencies && !devDependencies && !peerDependencies) return false;
  const depList = constructDepsToUpdateList(dependencies, versionMap);
  const devDepList = constructDepsToUpdateList(devDependencies, versionMap);
  const peerDepList = constructDepsToUpdateList(peerDependencies, versionMap);
  if (isDebugging)
    console.log(`${DEBUG_NAME}checkDependenciesForVersion:`, {
      depList,
      devDepList,
      peerDepList,
    });
  if (!depList.length && !devDepList.length && !peerDepList.length) {
    return false;
  }
  if (!isSilent)
    Array.from([depList, devDepList, peerDepList], (list) =>
      writeConsoleMsgs(name, list)
    );
  if (isUpdating) {
    const updatedJson = constructJson(
      json,
      { depList, devDepList, peerDepList },
      isDebugging
    );
    const { path, ...newJson } = updatedJson;
    if (!isTesting) {
      writeFileSync(path, JSON.stringify(newJson, null, 2).concat("\n"));
    } else {
      console.log(
        `${gradient.teen(
          `${LOG_NAME}checkDependenciesForVersion:test-writeFileSync:`
        )}\n   👯‍♂️ => ${path}`
      );
    }
  }
  return true;
};

/**
 * checkMatches
 * @description checks a glob of json files for dependency discrepancies
 * @param {options.files} array
 * @param {options.cwd} string
 * @param {options.isUpdating} boolean
 * @param {options.versionMap} object
 * @param {options.rootDir} string
 * @param {options.isDebugging} boolean
 * @param {options.isSilent} boolean
 * @param {options.isCLI} boolean
 * @param {options.isTesting} boolean
 * @returns {void}
 */
export const checkMatches = ({
  versionMap,
  rootDir,
  files,
  isUpdating = false,
  isDebugging = false,
  isSilent = true,
  isCLI = false,
  isTesting = false,
}: CheckMatches): void => {
  const packagesNeedingUpdate = files
    .map((file) => {
      const path = `${rootDir}${file}`;
      const packageJson = readFileSync(path, "utf8");
      const json = JSON.parse(packageJson);
      return { ...json, path };
    })
    .filter((json) =>
      checkDependenciesForVersion(versionMap, json, {
        isUpdating,
        isDebugging,
        isSilent,
        isTesting,
      })
    );

  if (isDebugging)
    console.log(
      `${gradient.passion(`${DEBUG_NAME}checkMatches:`)}\n   🤼‍♀️ => see updates`,
      {
        packagesNeedingUpdate,
      }
    );

  const isOutOfDate = packagesNeedingUpdate.length > 0;
  if (isOutOfDate && !isUpdating) {
    console.error(
      `${gradient.passion(
        `codependence:`
      )}\n   🤼‍♀️ => dependencies are not correct 😞`
    );
    if (isCLI) process.exit(1);
  } else if (isOutOfDate) {
    console.info(
      `${gradient.teen(
        `codependence:`
      )}\n   👯‍♂️ => dependencies were not correct but should be updated! Check your git status. 😃`
    );
  } else {
    console.log(
      `${gradient.teen(
        `codependence:`
      )}\n   👯‍♂️ => no dependency issues found! 👌`
    );
  }
};

/**
 * checkFiles
 * @description checks a glob of json files for dependency discrepancies
 * @param {options.codependencies} array
 * @param {options.rootDir} string
 * @param {options.ignore} array
 * @param {options.update} boolean
 * @param {options.files} array
 * @param {options.rootDir} string
 * @param {options.debug} boolean
 * @param {options.silent} boolean
 * @param {options.isCLI} boolean
 * @param {options.isTesting} boolean
 * @returns {void}
 */
export const checkFiles = async ({
  codependencies,
  files: matchers = ["package.json"],
  rootDir = "./",
  ignore = ["node_modules/**/*", "**/node_modules/**/*"],
  update = false,
  debug = false,
  silent = false,
  isCLI = false,
  isTesting = false,
}: CheckFiles): Promise<void> => {
  try {
    const files = glob(matchers, { cwd: rootDir, ignore });
    if (!codependencies) throw '"codependencies" are required';
    const versionMap = await constructVersionMap(
      codependencies,
      execPromise,
      debug
    );
    checkMatches({
      versionMap,
      rootDir,
      files,
      isCLI,
      isSilent: silent,
      isUpdating: update,
      isDebugging: debug,
      isTesting,
    });
  } catch (err) {
    if (debug)
      console.error(
        `${gradient.passion(`${DEBUG_NAME}:checkFiles:`)}\n   🤼‍♀️ => ${err}`
      );
  }
};

export const script = checkFiles;
export const codependence = checkFiles;
export default codependence;
