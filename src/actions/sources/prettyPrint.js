/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at <http://mozilla.org/MPL/2.0/>. */

// @flow

import assert from "../../utils/assert";
import { remapBreakpoints } from "../breakpoints";

import { setPausePoints, setSymbols } from "../ast";
import { prettyPrint } from "../../workers/pretty-print";
import { setSource } from "../../workers/parser";
import { getPrettySourceURL, isLoaded } from "../../utils/source";
import { loadSourceText } from "./loadSourceText";
import { selectLocation } from "../sources";
import { mapFrames } from "../pause";

import {
  getSource,
  getSourceByURL,
  getSelectedLocation
} from "../../selectors";

import type { ThunkArgs } from "../types";

export function createPrettySource(sourceId: string) {
  return async ({ dispatch, getState, sourceMaps }: ThunkArgs) => {
    const source = getSource(getState(), sourceId);
    const url = getPrettySourceURL(source.url);
    const id = await sourceMaps.generatedToOriginalId(sourceId, url);

    const prettySource = {
      url,
      id,
      isPrettyPrinted: true,
      contentType: "text/javascript",
      loadedState: "loading"
    };
    dispatch({ type: "ADD_SOURCE", source: prettySource });

    const { code, mappings } = await prettyPrint({ source, url });
    await sourceMaps.applySourceMap(source.id, url, code, mappings);

    const loadedPrettySource = {
      ...prettySource,
      text: code,
      loadedState: "loaded"
    };

    setSource(loadedPrettySource);

    dispatch({ type: "UPDATE_SOURCE", source: loadedPrettySource });

    return prettySource;
  };
}

/**
 * Toggle the pretty printing of a source's text. All subsequent calls to
 * |getText| will return the pretty-toggled text. Nothing will happen for
 * non-javascript files.
 *
 * @memberof actions/sources
 * @static
 * @param string id The source form from the RDP.
 * @returns Promise
 *          A promise that resolves to [aSource, prettyText] or rejects to
 *          [aSource, error].
 */
export function togglePrettyPrint(sourceId: string) {
  return async ({ dispatch, getState, client, sourceMaps }: ThunkArgs) => {
    const source = getSource(getState(), sourceId);
    if (!source) {
      return {};
    }

    if (!isLoaded(source)) {
      await dispatch(loadSourceText(source));
    }

    assert(
      sourceMaps.isGeneratedId(sourceId),
      "Pretty-printing only allowed on generated sources"
    );

    const selectedLocation = getSelectedLocation(getState());
    const url = getPrettySourceURL(source.url);
    const prettySource = getSourceByURL(getState(), url);

    const options = {};
    if (selectedLocation) {
      options.location = await sourceMaps.getOriginalLocation(selectedLocation);
    }

    if (prettySource) {
      const _sourceId = prettySource.get("id");
      return dispatch(
        selectLocation({ ...options.location, sourceId: _sourceId })
      );
    }

    const newPrettySource = await dispatch(createPrettySource(sourceId));

    await dispatch(remapBreakpoints(sourceId));
    await dispatch(mapFrames());
    await dispatch(setPausePoints(newPrettySource.id));
    await dispatch(setSymbols(newPrettySource.id));

    return dispatch(
      selectLocation({ ...options.location, sourceId: newPrettySource.id })
    );
  };
}
