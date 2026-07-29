import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabaseClient';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Perform a lightweight query to keep Supabase Postgres active
    const { data, count, error } = await supabase
      .from('master_mahasiswa')
      .select('*', { count: 'exact', head: true });

    if (error) {
      return NextResponse.json(
        { status: 'error', message: error.message, timestamp: new Date().toISOString() },
        { status: 500 }
      );
    }

    return NextResponse.json({
      status: 'ok',
      message: 'Supabase ping successful (Keep-Alive)',
      masterTotalRows: count ?? 0,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json(
      { status: 'error', message: err.message || 'Internal error', timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}
