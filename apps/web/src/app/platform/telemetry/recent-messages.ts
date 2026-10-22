export class RecentMessages {
  private readonly ids = new Set<string>();
  get size(): number {
    return this.ids.size;
  }
  remember(id: string): boolean {
    const seen = this.ids.delete(id);
    this.ids.add(id);
    if (this.ids.size > 5000) this.ids.delete(this.ids.values().next().value!);
    return seen;
  }
  clear(): void {
    this.ids.clear();
  }
}
