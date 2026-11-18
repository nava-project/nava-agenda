package retention

import (
	"context"
	"errors"
	"testing"
)

type fakeStore struct {
	results []int
	errAt   int
	calls   int
	limits  []int
}

func (f *fakeStore) AnonymizeExpired(_ context.Context, limit int) (int, error) {
	f.calls++
	f.limits = append(f.limits, limit)
	if f.errAt == f.calls {
		return 0, errors.New("boom")
	}
	if len(f.results) == 0 {
		return 0, nil
	}
	n := f.results[0]
	f.results = f.results[1:]
	return n, nil
}

func TestRunOnce_StopsAtFirstPartialBatch(t *testing.T) {
	store := &fakeStore{results: []int{BatchLimit, BatchLimit, 7, BatchLimit}}
	total, err := NewService(store).RunOnce(context.Background())
	if err != nil {
		t.Fatalf("RunOnce: %v", err)
	}
	if total != 2*BatchLimit+7 || store.calls != 3 {
		t.Fatalf("total=%d calls=%d, want %d and 3", total, store.calls, 2*BatchLimit+7)
	}
	for _, limit := range store.limits {
		if limit != BatchLimit {
			t.Fatalf("limit=%d, want %d", limit, BatchLimit)
		}
	}
}

func TestRunOnce_NothingDueMakesOneCall(t *testing.T) {
	store := &fakeStore{}
	total, err := NewService(store).RunOnce(context.Background())
	if err != nil || total != 0 || store.calls != 1 {
		t.Fatalf("total=%d calls=%d err=%v, want 0, 1, nil", total, store.calls, err)
	}
}

func TestRunOnce_CapsBatchesPerRun(t *testing.T) {
	results := make([]int, maxBatchesPerRun+5)
	for i := range results {
		results[i] = BatchLimit
	}
	store := &fakeStore{results: results}
	total, err := NewService(store).RunOnce(context.Background())
	if err != nil {
		t.Fatalf("RunOnce: %v", err)
	}
	if store.calls != maxBatchesPerRun || total != maxBatchesPerRun*BatchLimit {
		t.Fatalf("calls=%d total=%d, want %d batches", store.calls, total, maxBatchesPerRun)
	}
}

func TestRunOnce_ReturnsWhatWasDoneBeforeAnError(t *testing.T) {
	store := &fakeStore{results: []int{BatchLimit}, errAt: 2}
	total, err := NewService(store).RunOnce(context.Background())
	if err == nil {
		t.Fatal("want an error from the second batch")
	}
	if total != BatchLimit {
		t.Fatalf("total=%d, want the committed first batch (%d)", total, BatchLimit)
	}
}

func TestRunOnce_StopsWhenContextIsCanceled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	store := &fakeStore{results: []int{BatchLimit}}
	if _, err := NewService(store).RunOnce(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("err=%v, want context.Canceled", err)
	}
	if store.calls != 0 {
		t.Fatalf("calls=%d, want 0 with a canceled context", store.calls)
	}
}
