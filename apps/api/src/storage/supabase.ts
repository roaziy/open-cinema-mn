import { createClient } from '@supabase/supabase-js';
import type { StorageProvider } from './index';

/** Uploads to a public Supabase Storage bucket using the service role key. */
export class SupabaseStorage implements StorageProvider {
  private readonly client;

  constructor(
    url: string,
    serviceRoleKey: string,
    private readonly bucket: string,
  ) {
    this.client = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<string> {
    const files = this.client.storage.from(this.bucket);
    const { error } = await files.upload(key, body, { contentType, upsert: true });
    if (error) throw new Error(`supabase upload failed: ${error.message}`);
    return files.getPublicUrl(key).data.publicUrl;
  }
}
