export function StorageError({ message }: { message: string }) {
  return (
    <p role="alert" className="px-10 py-8 font-ui text-record-red">
      {message}
    </p>
  )
}
