/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra
*/

"use strict";

const util = require("util");
const webpackOptionsSchema = require("../schemas/WebpackOptions.json");
const Compiler = require("./Compiler");
const MultiCompiler = require("./MultiCompiler");
const WebpackOptionsApply = require("./WebpackOptionsApply");
const {
	applyWebpackOptionsDefaults,
	applyWebpackOptionsBaseDefaults
} = require("./config/defaults");
const { getNormalizedWebpackOptions } = require("./config/normalization");
const NodeEnvironmentPlugin = require("./node/NodeEnvironmentPlugin");
const validateSchema = require("./validateSchema");

/** @typedef {import("../declarations/WebpackOptions").WebpackOptions} WebpackOptions */
/** @typedef {import("./Compiler")} Compiler */
/** @typedef {import("./Compiler").WatchOptions} WatchOptions */
/** @typedef {import("./MultiCompiler")} MultiCompiler */
/** @typedef {import("./MultiStats")} MultiStats */
/** @typedef {import("./Stats")} Stats */

/**
 * @template T
 * @callback Callback
 * @param {Error=} err
 * @param {T=} stats
 * @returns {void}
 */

/**
 * @param {WebpackOptions[]} childOptions options array
 * @returns {MultiCompiler} a multi-compiler
 */
const createMultiCompiler = childOptions => {
	const compilers = childOptions.map(options => createCompiler(options));
	const compiler = new MultiCompiler(compilers);
	for (const childCompiler of compilers) {
		if (childCompiler.options.dependencies) {
			compiler.setDependencies(
				childCompiler,
				childCompiler.options.dependencies
			);
		}
	}
	return compiler;
};

//// 创建编译器
/**
 * @param {WebpackOptions} rawOptions options object
 * @returns {Compiler} a compiler
 */
const createCompiler = rawOptions => {
	//// 获取配置项
	const options = getNormalizedWebpackOptions(rawOptions);

	//// 添加base默认配置项
	applyWebpackOptionsBaseDefaults(options);

	//// 创建compiler实例
	const compiler = new Compiler(options.context);

	//// 赋值配置项
	compiler.options = options;

	//// node环境变量插件
	new NodeEnvironmentPlugin({
		infrastructureLogging: options.infrastructureLogging
	}).apply(compiler);

	//// 调用插件
	if (Array.isArray(options.plugins)) {
		for (const plugin of options.plugins) {
			if (typeof plugin === "function") {
				plugin.call(compiler, compiler);
			} else {
				plugin.apply(compiler);
			}
		}
	}

	//// 添加默认配置项
	applyWebpackOptionsDefaults(options);

	//// 调用environment hook
	compiler.hooks.environment.call();

  //// 调用afterEnvironment hook
	compiler.hooks.afterEnvironment.call();

	//// ?
	new WebpackOptionsApply().process(options, compiler);

	//// 调用initialize hook
	compiler.hooks.initialize.call();

	return compiler;
};

//// webpack js api函数

/**
 * @callback WebpackFunctionSingle
 * @param {WebpackOptions} options options object
 * @param {Callback<Stats>=} callback callback
 * @returns {Compiler} the compiler object
 */

/**
 * @callback WebpackFunctionMulti
 * @param {WebpackOptions[]} options options objects
 * @param {Callback<MultiStats>=} callback callback
 * @returns {MultiCompiler} the multi compiler object
 */

const webpack = /** @type {WebpackFunctionSingle & WebpackFunctionMulti} */ ((
	options,
	callback
) => {
	const create = () => {
		//// 验证配置项
		validateSchema(webpackOptionsSchema, options);

		/** @type {MultiCompiler|Compiler} */
		let compiler;
		let watch = false;

		/** @type {WatchOptions|WatchOptions[]} */
		let watchOptions;

		if (Array.isArray(options)) {
			//// 多配置
			/** @type {MultiCompiler} */
			compiler = createMultiCompiler(options);
			watch = options.some(options => options.watch);
			watchOptions = options.map(options => options.watchOptions || {});
		} else {
			//// 单配置
			/** @type {Compiler} */
			compiler = createCompiler(options);
			watch = options.watch;
			watchOptions = options.watchOptions || {};
		}

		return { compiler, watch, watchOptions };
	};

	if (callback) {
		try {
			const { compiler, watch, watchOptions } = create();
			if (watch) {
				compiler.watch(watchOptions, callback);
			} else {
				compiler.run((err, stats) => {
					compiler.close(err2 => {
						callback(err || err2, stats);
					});
				});
			}
			return compiler;
		} catch (err) {
			process.nextTick(() => callback(err));
			return null;
		}
	} else {
		const { compiler, watch } = create();
		if (watch) {
			util.deprecate(
				() => {},
				"A 'callback' argument need to be provided to the 'webpack(options, callback)' function when the 'watch' option is set. There is no way to handle the 'watch' option without a callback.",
				"DEP_WEBPACK_WATCH_WITHOUT_CALLBACK"
			)();
		}
		return compiler;
	}
});

module.exports = webpack;
