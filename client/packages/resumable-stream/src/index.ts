import { Config, init, InstantError, requireApiURI } from '@sidekickdb/admin';

export interface CreateResumableStreamContextOptions {
  /**
   * A function that takes a promise and ensures that the current program stays alive
   * until the promise is resolved.
   *
   * If you are deploying to a server environment, where you don't have to worry about
   * the function getting suspended, pass in null.
   */
  waitUntil: ((promise: Promise<unknown>) => void) | null;
  /**
   * The appId for your app. It may also be provided with the SIDEKICK_APP_ID or NEXT_PUBLIC_SIDEKICK_APP_ID environment variable
   * (or their older names, INSTANT_APP_ID and NEXT_PUBLIC_INSTANT_APP_ID).
   */
  appId?: string;
  /**
   * The admin token for your app. It may also be provided with the SIDEKICK_APP_ADMIN_TOKEN environment variable
   * (or its older name, INSTANT_APP_ADMIN_TOKEN).
   */
  adminToken?: string;
  /**
   * URL of your SidekickDB server. Falls back to the SIDEKICK_API_URI
   * environment variable (or its older name, INSTANT_API_URI); one of the two
   * is required.
   */
  apiURI?: string;
  /**
   * Enable verbose logging from the underlying instant connection
   */
  verbose?: boolean;
}

export interface ResumableStreamContext {
  /**
   * Creates or resumes a resumable stream.
   *
   * Does not throw if the underlying stream is already done. The output can always be read from the
   * stream and does not have to be saved to a separate table after streaming is completed.
   *
   * By default returns the entire buffered stream. Use `skipCharacters` to resume from a specific point.
   *
   * @param streamId - The ID of the stream. Must be unique for each stream.
   * @param makeStream - A function that returns a stream of strings. It's only executed if the stream it not yet in progress.
   * @param skipCharacters - Number of characters to skip
   * @returns A readable stream of strings. Returns the stream even if it is fully done (streams are persisted until deleted)
   */
  resumableStream: (
    streamId: string,
    makeStream: () => ReadableStream<string>,
    skipCharacters?: number,
  ) => Promise<ReadableStream<string> | null>;
  /**
   * Resumes a stream that was previously created by `createNewResumableStream`.
   *
   * @param streamId - The ID of the stream. Must be unique for each stream.
   * @param skipCharacters - Number of characters to skip
   * @returns A readable stream of strings. Returns the stream even if it is fully done (streams are persisted until deleted)
   */
  resumeExistingStream: (
    streamId: string,
    skipCharacters?: number,
  ) => Promise<ReadableStream<string> | null | undefined>;
  /**
   * Creates a new resumable stream.
   *
   * @param streamId - The ID of the stream. Must be unique for each stream.
   * @param makeStream - A function that returns a stream of strings.
   * @param skipCharacters - Number of characters to skip
   * @returns A readable stream of strings. Returns the stream even if it is fully done (streams are persisted until deleted)
   */
  createNewResumableStream: (
    streamId: string,
    makeStream: () => ReadableStream<string>,
    skipCharacters?: number,
  ) => Promise<ReadableStream<string> | null>;

  /**
   * Checks if a stream with the given streamId exists.
   * @param streamId - The ID of the stream.
   * @returns null if there is no stream with the given streamId. True if a stream with the given streamId exists. "DONE" if the stream is fully done.
   */
  hasExistingStream: (streamId: string) => Promise<null | true | 'DONE'>;
}

function skipCharactersTransformer(skipCharacters: number) {
  let skipLeft = skipCharacters;
  return new TransformStream<string>({
    transform(chunk, controller) {
      if (!skipLeft) {
        controller.enqueue(chunk);
        return;
      }
      if (skipLeft > chunk.length) {
        skipLeft -= chunk.length;
        return;
      }
      const remaining = chunk.slice(skipLeft);
      skipLeft = 0;
      controller.enqueue(remaining);
    },
  });
}

/**
 * Reads an environment variable that can be set under its SidekickDB name
 * (`SIDEKICK_APP_ID`) or its older name (`INSTANT_APP_ID`). The SidekickDB name
 * wins; an empty value counts as unset.
 */
function readEnv(sidekickName: string): string | undefined {
  return (
    process.env[sidekickName] ||
    process.env[sidekickName.replace('SIDEKICK_', 'INSTANT_')]
  );
}

export function createResumableStreamContext(
  options: CreateResumableStreamContextOptions,
): ResumableStreamContext {
  const appId =
    options.appId ||
    readEnv('SIDEKICK_APP_ID') ||
    readEnv('NEXT_PUBLIC_SIDEKICK_APP_ID');
  if (!appId) {
    throw new Error(
      'Missing appId. Pass it as an argument to createResumableStreamContext or set either the SIDEKICK_APP_ID or NEXT_PUBLIC_SIDEKICK_APP_ID environment variable.',
    );
  }
  const adminToken = options.adminToken || readEnv('SIDEKICK_APP_ADMIN_TOKEN');
  if (!adminToken) {
    throw new Error(
      'Missing adminToken. Pass it as an argument to createResumableStreamContext or set the SIDEKICK_APP_ADMIN_TOKEN environment variable.',
    );
  }

  const apiURI = requireApiURI(options.apiURI || readEnv('SIDEKICK_API_URI'), {
    target: 'createResumableStreamContext()',
    envVar: 'SIDEKICK_API_URI',
  });

  const config: Config = { appId, adminToken, apiURI };

  if (options.verbose) {
    config.verbose = options.verbose;
  }

  const db = init(config);

  async function resumableStream(
    streamId: string,
    makeStream: () => ReadableStream<string>,
    skipCharacters?: number,
  ): Promise<ReadableStream<string> | null> {
    const writeStream = db.streams.createWriteStream({
      clientId: streamId,
      waitUntil: options.waitUntil ?? undefined,
    });
    try {
      const s = await writeStream.streamId();
      const inputStream = makeStream();
      inputStream.pipeTo(writeStream);
      const readStream = db.streams.createReadStream({ streamId: s });
      if (skipCharacters) {
        return readStream.pipeThrough(
          skipCharactersTransformer(skipCharacters),
        );
      }
      return readStream;
    } catch (e) {
      const readStream = db.streams.createReadStream({ clientId: streamId });
      if (skipCharacters) {
        return readStream.pipeThrough(
          skipCharactersTransformer(skipCharacters),
        );
      }
      return readStream;
    }
  }

  async function resumeExistingStream(
    streamId: string,
    skipCharacters?: number,
  ): Promise<ReadableStream<string> | null | undefined> {
    const readStream = db.streams.createReadStream({ clientId: streamId });
    try {
      await readStream.streamId();
    } catch (e) {
      if (
        e instanceof InstantError &&
        (e.hint as any)?.errors?.[0]?.message === 'Stream is missing.'
      ) {
        return undefined;
      }
      throw e;
    }
    if (skipCharacters) {
      return readStream.pipeThrough(skipCharactersTransformer(skipCharacters));
    }
    return readStream;
  }

  async function createNewResumableStream(
    streamId: string,
    makeStream: () => ReadableStream<string>,
    skipCharacters?: number,
  ): Promise<ReadableStream<string> | null> {
    const inputStream = makeStream();
    const writeStream = db.streams.createWriteStream({
      clientId: streamId,
      waitUntil: options.waitUntil ?? undefined,
    });

    // Wait for stream to be acknowledged by the server
    await writeStream.streamId();

    inputStream.pipeTo(writeStream);
    const readStream = db.streams.createReadStream({ clientId: streamId });
    if (skipCharacters) {
      return readStream.pipeThrough(skipCharactersTransformer(skipCharacters));
    }
    return readStream;
  }

  async function hasExistingStream(
    streamId: string,
  ): Promise<null | true | 'DONE'> {
    const data = await db.query({
      $streams: { $: { where: { clientId: streamId } } },
    });

    const stream = data?.$streams?.[0];
    if (stream?.done) {
      return 'DONE';
    }
    if (stream) {
      return true;
    }
    return null;
  }

  return {
    resumableStream,
    resumeExistingStream,
    createNewResumableStream,
    hasExistingStream,
  };
}
