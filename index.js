const ReactDOMServer = require('react-dom/server');
const React = require('react');
const evaluate = require('eval');

const { getDataFromCacheOrMethod } = require('./cache');

const GLOBALS_MOCK = { global, window: global };

module.exports = class ReactToStaticHtmlWebpackPlugin {
  constructor(props = {}) {
    this.globals = Object.assign(GLOBALS_MOCK, props.globals) || GLOBALS_MOCK;
    this.htmlHeader = props.htmlHeader || '<!DOCTYPE html>';
    this.chunks = props.chunks || [];
    this.excludedChunks = props.excludedChunks || [];
    this.postRender = props.postRender || [];
    this.keepJsFile = props.keepJsFile || false;
  }

  /**
   * @param {*} compiler
   */
  apply(compiler) {
    compiler.hooks.thisCompilation.tap('react-to-static-html-webpack-plugin', compilation => {
      compilation.hooks.additionalAssets.tapAsync('react-to-static-html-webpack-plugin', doneOptimize => {
        const startDate = Date.now();
        console.log('STARTED => ', startDate);
        const { assets, chunks } = compilation;
        const chunkPromises = this._compileChunk(chunks, assets, compilation);

        Promise.all(chunkPromises)
          .then(() => {
            console.log('L => Finished in (ms): ', Date.now() - startDate);
            
            doneOptimize();
          })
          .catch(ex => {
            console.log('E => Finished in (ms): ', Date.now() - startDate);
            compilation.errors.push(ex);
            doneOptimize();
          });
      });
    });
  }

  _compileChunk(chunks, assets, compilation) {
    return chunks
      .map(c => {
        try {
          if ((!this._hasChunks() || this._isChunksToWork(c.name)) && !this._isExcludedChunks(c.name)) {
            return this._compileChunkSources(c, assets, compilation);
          }
        } catch (ex) {
          compilation.errors.push(ex.stack);
        }

        return Promise.resolve();
      })
      .reduce((p, n) => {
        if (Array.isArray(n)) {
          p = p.concat(n);
        } else {
          p.push(n);
        }

        return p;
      }, []);
  }

  _compileChunkSources(chunk, assets, compilation) {
    return chunk.files
      .filter(f => f.indexOf(`${chunk.name}.js`) >= 0)
      .map(f => {
        const renderedFilePromise = this._renderSourceIfNeed(f, assets[f].source(), chunk.contentHash.javascript);

        renderedFilePromise.then(renderedFile => {
          const fileName = this._parseAssetName(f);

          compilation.assets[fileName] = this._parseRenderToAsset(renderedFile);
          chunk.files.push(fileName);
          chunk.files.splice(chunk.files.indexOf(f), 1);

          if (!this.keepJsFile) {
            delete compilation.assets[f];
          }

          return renderedFile;
        });

        return renderedFilePromise;
      });
  }

  async _renderSourceIfNeed(assetName, source, hash) {
    return getDataFromCacheOrMethod(assetName, hash, async () => await this._renderSource(assetName, source));
  }

  async _renderSource(assetName, source) {
    const evaluatedSource = evaluate(source, assetName, this._getGlobalsCopy(), true);
    const keys = Object.keys(evaluatedSource);
    let element = evaluatedSource.default;

    if (this._hadADefaultOrJustOneComponent(evaluatedSource)) {
      throw new Error(`${assetName} must have a default or just one component`);
    }

    if (element == null) {
      element = evaluatedSource[keys[0]];
    }

    let elementPromise = Promise.resolve(element);

    return elementPromise
      .then(element => {
        if (!React.isValidElement(element)) {
          element = React.createElement(element);
        }

        let renderedFile = ReactDOMServer.renderToString(element);

        if (renderedFile.trim().startsWith('<html')) {
          renderedFile = `${this.htmlHeader}${renderedFile}`;
        }

        this.postRender.forEach(f => {
          renderedFile = f(renderedFile);
        });

        return renderedFile;
      })
      .catch(ex => {
        ex.message = `File ${assetName} gave an error: ${ex.message}`;

        throw ex;
      });
  }

  _getGlobalsCopy() {
    let globalsCopy = Object.assign({}, this.globals);

    globalsCopy.global = Object.assign({}, globalsCopy.global);
    globalsCopy.window = Object.assign({}, globalsCopy.window);

    return globalsCopy;
  }

  _hadADefaultOrJustOneComponent(evaluatedSource) {
    const keys = Object.keys(evaluatedSource);

    return evaluatedSource == null || (typeof evaluatedSource.default !== 'function' && (keys.length > 1 || keys.length === 0));
  }

  _parseAssetName(assetName) {
    return `${assetName.replace(/\.[^/.]+$/, '')}.html`;
  }

  _parseRenderToAsset(render) {
    return {
      source: () => {
        return render;
      },
      size: () => {
        return render.length;
      },
    };
  }

  _hasChunks() {
    return this.chunks.length > 0;
  }

  _isChunksToWork(chunkId) {
    return this.chunks.some(c => c === chunkId);
  }

  _isExcludedChunks(chunkId) {
    return this.excludedChunks.some(c => c === chunkId);
  }
};
