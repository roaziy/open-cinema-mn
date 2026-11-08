import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { MovieEditor } from '@/components/movies/MovieEditor';
import { ErrorState } from '@/components/ui/ErrorState';
import { PageHeader } from '@/components/ui/PageHeader';
import { getMovie, safely } from '@/lib/admin-data';
import { isUuid } from '@/lib/ids';

type Props = { params: Promise<{ id: string }> };

export const metadata: Metadata = { title: 'Киноны мэдээлэл' };

export default async function MoviePage({ params }: Props) {
  const { id } = await params;
  if (id === 'new') {
    return (
      <>
        <PageHeader title="Шинэ кино" subtitle="Постер оруулахад өнгийг автоматаар санал болгоно" />
        <MovieEditor movie={null} />
      </>
    );
  }
  if (!isUuid(id)) notFound();
  const movie = await safely(() => getMovie(id));
  if (!movie) {
    return (
      <>
        <PageHeader title="Киноны мэдээлэл" />
        <ErrorState message="Киноны мэдээллийг ачаалж чадсангүй." />
      </>
    );
  }
  return (
    <>
      <PageHeader title={movie.title} subtitle="Киноны мэдээлэл, постер, өнгө" />
      <MovieEditor movie={movie} />
    </>
  );
}
